# Postgres DB Manager

Small local-only web UI for browsing and querying Postgres databases.

## Run

```bash
node db/db-manager/server.js
```

Open: http://127.0.0.1:8088

## Stop

```bash
lsof -ti tcp:8088 | xargs kill -9
```
