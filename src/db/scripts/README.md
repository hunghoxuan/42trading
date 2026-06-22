# Database Scripts

Postgres schema and sanitized seed helpers for local development.

## Files

- `src/db/schema/mt5_schema.sql` - schema-only dump from the restored local database.
- `src/db/schema/mt5_seed_sanitized.sql` - data seed with production secrets redacted.
- `src/db/scripts/generate_sanitized_seed.js` - regenerates the sanitized seed from a local Postgres database.

## Generate Seed

Default source:

```bash
node src/db/scripts/generate_sanitized_seed.js
```

Override source or output:

```bash
SEED_DATABASE_URL=postgresql://macmini@127.0.0.1:5432/mt5_bridge_local \
SEED_OUTPUT=src/db/schema/mt5_seed_sanitized.sql \
node src/db/scripts/generate_sanitized_seed.js
```

## Restore Locally

Example:

```bash
createdb mt5_bridge_local
psql -d mt5_bridge_local -f src/db/schema/mt5_schema.sql
psql -d mt5_bridge_local -f src/db/schema/mt5_seed_sanitized.sql
```

## Safety

- Do not commit raw production dumps.
- The sanitized seed nulls password hashes, API-key hashes, lease tokens, and token-like JSON values.
- Review generated SQL before using it in shared environments.
