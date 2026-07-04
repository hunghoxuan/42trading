# Fix 3001 Being Killed

Use this when local `src/api` on `:3001` feels unstable, gets replaced by another process, or the UI starts reporting that the API is down.

## What We Actually Found

The `3001` instability came from a few different issues that looked similar from the UI:

1. More than one owner tried to manage port `3001`.
2. `start_api.sh launchctl` used ad-hoc `launchctl submit` jobs instead of a stable LaunchAgent.
3. `start_api.sh launchctl --force` did not really force a restart when `3001` was already healthy.
4. The UI logout symptom was amplified by server-side in-memory sessions: an API restart could make the user look "logged out" even when the real problem was only a process restart.

The current local shape is simpler:

- `start_api.sh` is the only API start entrypoint.
- normal API start does **not** kill port `3001`
- `--force` is required before killing an unhealthy existing owner
- `launchctl` mode now installs/boots a real LaunchAgent: `com.trading.web-api.local`
- the LaunchAgent runs `node src/api/app/server.js` directly, so launchd tracks the real API process
- UI auth now uses signed JWT cookies, so an API restart no longer destroys the login session by itself

## Root Cause Notes

### 1. Port ownership confusion

Different scripts historically tried to "help" by reclaiming or restarting `3001`.
That made it easy to end up with:

- a random leftover node process on `3001`
- a temporary `launchctl submit` job
- a foreground shell process

all taking turns owning the same port.

### 2. Ad-hoc `launchctl submit` was the wrong long-running model

Temporary `launchctl submit` labels are fine for short raw jobs, but they were a poor fit for a dev API service we want to inspect and re-run predictably.

The fix was:

- create/use a real plist-backed LaunchAgent
- use label `com.trading.web-api.local`
- run the real Node entrypoint directly from the plist

### 3. `--force` did not behave like force

Before the fix, `bash scripts/start/start_api.sh launchctl --force` could still skip the restart if `/health` was already `200`.

That meant:

- the plist might not refresh
- the old owner might stay alive
- debugging felt inconsistent

Now `--force` really kills the current owner and relaunches.

### 4. "3001 died" and "user got logged out" were not always the same bug

A big source of confusion was that the UI could show a login screen after API restart because auth session state used an in-memory map.

That is now fixed:

- UI session cookie is JWT-backed
- API restart alone should not log the user out

So if the user is kicked out now, investigate actual auth failures separately from process ownership.

## Quick Commands

Inspect current `3001` ownership and health:

```bash
bash scripts/start/fix_3001_being_killed.sh inspect
```

Inspect and repair if unhealthy:

```bash
bash scripts/start/fix_3001_being_killed.sh repair
```

## What The Script Checks

- who owns port `3001`
- whether `http://127.0.0.1:3001/health` responds
- whether `launchctl` owns the `com.trading.web-api.local` LaunchAgent
- recent API log output from `/tmp/trading-webhook-local.log`

## Expected Local Start Pattern

API only:

```bash
bash scripts/start/start_api.sh
bash scripts/start/start_api.sh background
bash scripts/start/start_api.sh launchctl
```

Full local dev:

```bash
bash scripts/start/start_dev.sh
```

`start_dev.sh` now checks whether `3001` is already healthy. If yes, it leaves API alone and starts admin.

## Current Known-Good Commands

API only, foreground:

```bash
bash scripts/start/start_api.sh
```

API only, background shell:

```bash
bash scripts/start/start_api.sh background
```

API only, launchctl:

```bash
bash scripts/start/start_api.sh launchctl
```

Force refresh the launchctl-owned API:

```bash
bash scripts/start/start_api.sh launchctl --force
```

## Debug Smells To Look For

- port `3001` is occupied but `/health` fails
- multiple different processes trying to own `3001`
- old ad-hoc label `trading-webhook-local` still showing up in `launchctl list`
- LaunchAgent missing while a random leftover node process still owns `3001`
- login screen appears after restart even though `/health` is healthy: check auth request failures, not just process state
