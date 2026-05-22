# Scripts Guide

This folder contains operational, deploy, install, test, migration, and utility scripts.

## Structure

- `deploy/`: deploy and versioning scripts
- `test/`: local and remote verification scripts
- `install/`: machine/setup helpers
- `ops/`: operational helpers for approvals/runbooks
- `db/`, `utils/`, `daemons/`: focused subsystem scripts

## Local Hosting

Run webhook + web UI against local Postgres:

```bash
bash scripts/local_host_db.sh
```

Run webhook + web UI against remote VPS Postgres through an SSH tunnel:

```bash
bash scripts/local_host_remote_db.sh
```

Required local env files:

- `webhook/.env`
  - `MT5_POSTGRES_URL_LOCAL`
  - `MT5_POSTGRES_URL_REMOTE`
  - `SIGNAL_API_KEY`
- `web-ui/.env`
  - `VITE_API_BASE=http://localhost:3001`
  - `VITE_API_KEY`

Safety notes:

- `local_host_db.sh` uses local Postgres.
- `local_host_remote_db.sh` can mutate remote VPS production data.
- Both scripts bind local app servers only through the underlying Node/Vite defaults.

## Usage Rule

When adding or changing scripts in any subfolder, keep a local `README.md` in that same folder with:

1. Purpose
2. How to run
3. Required flags/env
4. Examples
5. Safety notes

This prevents losing usage details across conversations.
