# Scripts Guide

This folder is for reusable teammate-facing automation only. If a script is one-off, personal, AI-only, legacy, or unclear in purpose, it belongs in `.local/`, not here.

## Keep In `scripts/`

### Local development
- `start/reset_stack_once.sh`: canonical local boot for `src/api` on `3001` and `src/admin` on `3000`
- `start/start_dev.sh`: foreground local runtime
- `start/start_api.sh`: API-only runtime
- `start/start_admin.sh`: admin-only runtime
- `start/fix_3001_being_killed.sh`: inspect/repair local API port-ownership issues on `3001`
- `start/start_docker.sh`: local Docker stack
- `start/start_mobile_access.sh`: expose local UI to phone via Tailscale or Cloudflare
- `start/local_host_db.sh`: run app against local Postgres
- `start/local_host_remote_db.sh`: run app against VPS Postgres through SSH tunnel

### Deploy and release
- `start/start_server.sh`: production VPS redeploy entrypoint
- `deploy/deploy_webhook.sh`: deploy current branch to the primary VPS runtime
- `deploy/deploy_branch_staging.sh`: isolated branch staging deploy
- `deploy/docker_build_bundle.sh`: build portable Docker image bundle
- `deploy/docker_deploy_staging.sh`: ship Docker bundle to staging
- `deploy/docker_deploy_prod.sh`: ship Docker bundle to prod
- `deploy/check_build_versions.sh`: verify release-version bumps
- `deploy/bump_build_versions.sh`: stamp build versions into shipped clients

### Install and machine setup
- `install/install_local_autostart.sh`: install macOS login autostart for local stack
- `install/uninstall_local_autostart.sh`: remove that autostart
- `install/install_ctrader_executor_bridge.sh`: install cTrader executor helper
- `install/install_ctrader_bars_launchd.sh`: schedule cTrader bar fetches
- `install/install_mt5_csv_sync_launchd.sh`: schedule MT5 CSV sync
- `install/install_token_toolchain.sh`: bootstrap common CLI tools

### Broker and bridge services
- `daemons/v2_broker_executor_daemon.js`: paper executor daemon for `/api/broker/*`
- `daemons/ctrader_downstream_server.js`: cTrader broker API downstream service
- `daemons/ctrader_executor_bridge.js`: cTrader execution bridge
- `daemons/fetch_ctrader_bars.sh`: fetch broker bars into local flow
- `daemons/mt5_csv_sync.sh`: sync MT5 CSV feed
- `daemons/switch_demo_mode.sh`: switch VPS demo execution mode

### Data migration and maintenance
- `migrate/migrate_postgres_to_user_sqlite.js`: migrate trade data from Postgres to user SQLite
- `migrate/migrate_user_accounts_unified_storage.mjs`: move account rows into unified user storage
- `migrate/migrate_user_settings_to_json.js`: export settings rows into JSON user storage
- `migrate/cleanup_stale_trade_active_dirs.sh`: reconcile stale active trade folders

## Moved Out Of `scripts/`

These were treated as local-only or legacy and should live under `.local/`:

- desktop app helpers tied to deleted `app/ui`: `build_desktop.sh`, `restart_desktop.sh`
- legacy SQLite migration helper superseded by `scripts/migrate/`: `migrate-to-sqlite.js`
- agent-approval warmup helper: `ops/warmup_overnight_approvals.sh`
- Claude cleanup helper with personal/AI-only scope: `ops/delete_all_claude_files.sh`

## Policy

- Do not add new files to `scripts/` unless the user explicitly asks for a reusable script and approves it.
- Do not add new repo-level tests to `tests/` unless the user explicitly asks for a test and approves it.
- Put scratch, one-time, investigation, migration throwaways, and AI-only helpers in `.local/`.
- If a script is worth keeping, document it in the nearest folder `README.md`.

## Local Hosting

Run app against local Postgres:

```bash
bash scripts/start/local_host_db.sh
```

Run app against remote VPS Postgres through an SSH tunnel:

```bash
bash scripts/start/local_host_remote_db.sh
```

Required local env files:

- `src/api/.env`
- `src/admin/.env`

Safety notes:

- `local_host_db.sh` uses local Postgres.
- `local_host_remote_db.sh` can mutate remote VPS production data.
- `start_server.sh` and `deploy/*` touch VPS environments.

## Usage Rule

When changing scripts in a folder, keep that folder's `README.md` current with:

1. Purpose
2. How to run
3. Required flags/env
4. Examples
5. Safety notes
