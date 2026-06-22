# 42Trade Workspace

## 🚀 AI Entry Point
All agents must start here:
1. Read [AI.md](./AI.md) (Root Instructions).

## 📂 Project Organization
- **`.agents`: FOR AI AGENTS, The "Knowledge" domain (Architecture, Features, Tickets), rules, skills
- **`docs`**: The "Knowledge" domain (Architecture, Features, Tickets).
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

### Local development (Vite + Node)
```bash
bash scripts/start/reset_stack_once.sh
# → http://localhost:3000  (UI with HMR)
# → http://localhost:3001  (API)
```
If you switch the UI DB dropdown to `VPS DB`, the local backend will auto-open the SSH tunnel to `127.0.0.1:15432` during development.

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

Preferred full local recovery (recommended):
```bash
bash scripts/start/reset_stack_once.sh
```

Webhook-only restart:
```bash
bash scripts/start/restart_webhook.sh manual
bash tests/verify_webhook_local.sh
```

Manual (foreground/background shell run):
```bash
bash scripts/start/restart_webhook.sh manual
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
See [.agents/.product/architecture/architecture.md](./.agents/.product/architecture/architecture.md) for the full system design.

---
*Refer to `.agents/BOOTSTRAP.md` for the full loading sequence and execution rules.*
