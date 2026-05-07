# Skill: Database Design

Use this skill for schema migrations, data modeling, and ensuring integrity across the PostgreSQL backend.

## Operational Rules

1.  **Idempotency First**: All migrations must use `IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
2.  **Dual ID Strategy**: Use `id` (Internal BigInt) for foreign keys and `sid` (External String) for public APIs.
3.  **No Data Loss**: Always backfill data with guards before dropping legacy columns.
4.  **Schema Sync**: Every DB change must be immediately reflected in [.agents/.product/architecture/db-schema.md] and the corresponding DB wiki/dashboard pages.

## Implementation Flow

1.  **Modeling**:
    - Update the documentation in `db-schema.md` first to visualize the change.
    - Check for normalization opportunities (e.g., separating user settings from core identity).
2.  **Implementation**:
    - Add the migration logic to the initialization block in `webhook/server.js`.
    - Ensure the query handles existing data safely.
3.  **Verification**:
    - Run the server locally and check the terminal logs for successful table/column creation.
    - Run `SELECT * FROM ...` to verify the new structure.

## Verification Checklist
- [ ] Migration is idempotent.
- [ ] `db-schema.md` updated.
- [ ] Public `sid` implemented if applicable.
