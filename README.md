# Trading Bot Workspace

## 🚀 AI Entry Point
All agents must start here:
1. Read [AI.md](./AI.md) (Root Instructions).
2. Read [.agents/BOOTSTRAP.md](./.agents/BOOTSTRAP.md) (Agent OS & Pathing).
3. Follow [.agents/rules.md](./.agents/rules.md) (Mandatory Constraints).

## 📂 Project Organization
- **`.agents/.product/`**: The "Knowledge" domain (Architecture, Features, Tickets).
- **`.agents/.raw/`**: The "Memory" domain (Not for AI logic).
- **`.agents/rules/`**: Global constraints and boundaries.
- **`.agents/skills/`**: Task-specific playbooks and guidelines.
- **`.agents/sync/`**: Agent-to-agent communication mailbox.
- **`webhook/`**: Backend API server (Node.js, port 3001).
- **`web-ui/`**: Frontend SPA (React + Vite, port 3000 with HMR).
- **`docker/`**: Dockerfiles + docker-compose + nginx config.
- **`bridge-clients/`**: MT5 EA (MQL5) and cTrader bridge (C#).
- **`scripts/`**: Ops tooling (deploy, test, start scripts).

## 🏁 Quick Start

### Local development (Vite + Node)
```bash
bash scripts/start/reset_stack_once.sh
# → http://localhost:3000  (UI with HMR)
# → http://localhost:3001  (API)
```

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
# pushes main → pulls on VPS → builds UI → restarts webhook → reloads nginx
```

## 🔁 Webhook Restart (Local)

Preferred full local recovery (recommended):
```bash
bash scripts/start/reset_stack_once.sh
```

Webhook-only restart:
```bash
bash scripts/start/restart_webhook.sh manual
bash scripts/test/verify_webhook_local.sh
```

Manual (foreground/background shell run):
```bash
bash scripts/start/restart_webhook.sh manual
bash scripts/test/verify_webhook_local.sh
```

Verification for agents:
```bash
bash scripts/test/verify_webhook_local.sh
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
