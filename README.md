# 42Trade Workspace

## Agent Entry Point
All agents should start with [agents/BOOTSTRAP.md](./agents/BOOTSTRAP.md).

## 📂 Project Organization
- **`agents`**: Agent operating rules and boot instructions.
- **`docs`**: Project and product knowledge, including architecture, specs, plans, and handoff notes.
- **`src/api/`**: Backend API server (Node.js, port 3001).
- **`src/admin/`**: Frontend SPA (React + Vite, port 3000 with HMR).
- **`src/config/`**: Shared app config, AI guides, and JSON schemas used by API + UI.
- **`docker/`**: Dockerfiles + docker-compose + nginx config.
- **`src/mt5-bridge/clients/`**: MT5 EA (MQL5) and cTrader bridge (C#).
- **`src/mt5-bridge/python/`**: Python MT5 bridge API scaffold.
- **`scripts/`**: Ops tooling (deploy, start, install, ops automation).
- **`tests/`**: Canonical home for repo-level tests and smoke checks.

## 🏁 Quick Start

Install workspace dependencies once from the repo root:

```bash
pnpm install
```

### Local development (Admin + API)
```bash
bash scripts/start/start_dev.sh
# → http://localhost:3000  (UI with HMR)
# → http://localhost:3001  (API)
```
`start_dev.sh` keeps the API on `3001` alive independently via the webhook `launchctl` helper, so closing or interrupting the foreground admin runner should no longer take the API down with it.
Local startup defaults to Postgres for both trades and 42Pay. The API reads `MT5_POSTGRES_URL` from [src/api/.env](/Users/macmini/Projects/moza/42trade/src/api/.env), and `42Pay` now follows the same backend selection as trades.

If you switch the UI DB dropdown to `VPS DB`, the local backend will auto-open the SSH tunnel to `127.0.0.1:15432` during development.

Other local start/restart helpers:

- API only: `bash scripts/start/start_api.sh`, `bash scripts/start/start_api.sh background`, or `bash scripts/start/start_api.sh launchctl`
- Admin only: `bash scripts/start/start_admin.sh`
- Standard local dev runner: `bash scripts/start/start_dev.sh`
- One-shot recovery helper: `bash scripts/start/reset_stack_once.sh`
- Local app against local DB: `bash scripts/start/local_host_db.sh`
- Local app against remote VPS DB tunnel: `bash scripts/start/local_host_remote_db.sh`

### Open the local UI on your phone
```bash
bash scripts/start/start_mobile_access.sh tailscale
bash scripts/start/start_mobile_access.sh cloudflare
bash scripts/start/start_mobile_access.sh both
```
See [scripts/start/mobile_access.md](./scripts/start/mobile_access.md) for setup and usage details.

### Local via Docker
```bash
bash scripts/start/start_docker.sh
# → http://localhost:8080   (UI via nginx)
# → http://localhost:3100   (API)
# → postgres://trading@localhost:5433
```

### Windows
```bat
scripts\start\start_local.bat
rem or
scripts\start\start_docker.bat
```

### Deploy to production VPS
```bash
bash scripts/start/start_server.sh
# pushes main → pulls on VPS → builds UI → restarts src/api → reloads nginx
```

## 🔁 Webhook Restart (Local)

Preferred standard local start:
```bash
bash scripts/start/start_dev.sh
```

If ports or watchers are wedged, use:
```bash
bash scripts/start/start_dev.sh --force
# or
bash scripts/start/reset_stack_once.sh
```

API background mode:
```bash
bash scripts/start/start_api.sh background
bash tests/verify_webhook_local.sh
```

API `launchctl` mode:
```bash
bash scripts/start/start_api.sh launchctl
bash tests/verify_webhook_local.sh
```

Verification for agents:
```bash
bash tests/verify_webhook_local.sh
# checks /health until timeout; exits non-zero on failure
```

## 🐳 Docker build
```bash
docker compose -f docker/docker-compose.yml build
```

## 📚 Architecture
Start with [docs/README.md](./docs/README.md). The docs hub links to architecture, schema, runtime/realtime, trading/backtests, integrations/storage, and API domain structure references.

---
Refer to [agents/BOOTSTRAP.md](./agents/BOOTSTRAP.md) for the loading sequence and execution rules.
