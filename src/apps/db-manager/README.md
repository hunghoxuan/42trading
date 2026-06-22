# Postgres DB Manager

Small local-only web UI for browsing and querying Postgres databases.

## Run

```bash
node src/apps/db-manager/server.js
```

Open: http://127.0.0.1:8088

## Dev Watch

Auto-restart on `db-manager` HTML/CSS/JS and shared UI changes:

```bash
pnpm dev:db-manager
```

Watched paths:

- `src/apps/db-manager`
- `src/shared/styles`
- `src/shared/components`
- `src/shared/bridge`

## Stop

```bash
lsof -ti tcp:8088 | xargs kill -9
```
