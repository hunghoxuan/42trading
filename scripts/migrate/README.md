# Migration Scripts

Reusable data migration and state-cleanup scripts.

## Files

- `migrate_postgres_to_user_sqlite.js`: migrate trade data from Postgres to per-user SQLite
- `migrate_user_accounts_unified_storage.mjs`: move account rows into unified user storage
- `migrate_user_settings_to_json.js`: export settings rows into JSON user storage
- `cleanup_stale_trade_active_dirs.sh`: reconcile stale active trade folders with runtime state

## Run

```bash
node scripts/migrate/migrate_postgres_to_user_sqlite.js
bash scripts/migrate/cleanup_stale_trade_active_dirs.sh
```

## Safety Notes

- These scripts may mutate local or remote-backed application data.
- Run them intentionally and verify the targeted storage backend first.
