# Lessons Learned — Stale Code in Local Dev

**Date**: 2026-05-31
**Agent**: Codex

## Problem

Made code changes to `webhook/server.js`. Verified the API worked correctly when testing directly on port 3001. But the UI (port 3000 via Vite proxy) continued serving stale data for over an hour of debugging, despite multiple restarts.

## Root Cause

**3 launchd plists** were auto-restarting old server code:
- `com.trading.webhook.local.plist`
- `com.trading.webui.local.plist`
- `com.trading.bot.local.plist`

Every time we killed the server process, launchd immediately spawned a new one from the **old** file state (before our edits). This created an endless cycle:
1. Kill server → launchd restarts old code
2. Start new server → port 3001 already taken (EADDRINUSE)
3. Vite proxy on 3000 connects to old server → serves stale data

The plists were installed by `scripts/install/` scripts.

## Detection

When `curl http://localhost:3001/api` returns correct data but `curl http://localhost:3000/api` (via Vite proxy) returns stale data, check:
1. `ps aux | grep webhook/server` — see if there are multiple or unexpected PIDs
2. `launchctl list | grep trading` — check for launchd services
3. `lsof -i:3001` — see which PID owns the port

## Fix

```bash
# Unload and disable all trading launchd plists
launchctl disable user/$(id -u)/com.trading.webhook.local
launchctl disable user/$(id -u)/com.trading.webui.local
launchctl disable user/$(id -u)/com.trading.bot.local
launchctl unload ~/Library/LaunchAgents/com.trading.*.plist

# Delete permanently
rm -f ~/Library/LaunchAgents/com.trading.*.plist

# Kill everything and start fresh
lsof -ti:3000,3001 | xargs kill -9
bash scripts/start/start_local.sh
```

## Prevention

1. **Never keep launchd plists active during local development.** Use `scripts/start/start_local.sh` for manual start.
2. After making server-side changes, always verify: `curl localhost:3001/endpoint` AND `curl localhost:3000/endpoint` (through Vite proxy) return the same data.
3. If data differs between port 3001 and 3000 → stale server process is running.
4. Store critical metadata (`broker_name`, `provider_code`) **both** at top-level AND inside `metadata` object so stale cached frontend code still works.
