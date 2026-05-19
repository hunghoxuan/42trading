# System DB & Cache Admin

## Status
Done

## User Flow
- System users can open `/system/db` to inspect approved database tables.
- The table list supports pagination, text search, and sortable column headers.
- The schema panel can hide/show columns in the table list without affecting the detail view.
- Selecting a row opens a full detail pane.
- System users can edit approved rows through a schema-driven form; nullable fields can be cleared, JSON fields stay JSON-aware, and updates only target tables/columns supported by the backend.
- System users can open `/system/cache` to inspect in-memory and Redis cache entries.
- Cache rows show relative update time and expiry countdown when TTL data is available.
- Cache list supports search across visible cache metadata/content preview plus symbol filtering.
- System users can inspect or delete individual cache keys, or clear the full cache store.

## Scope
- UI: `web-ui/src/pages/system/DatabasePage.jsx`
- UI: `web-ui/src/pages/system/CachePage.jsx`
- API: `web-ui/src/api.js`
- Backend: `webhook/server.js`

## Notes
- DB sorting and search are schema-validated on the backend to avoid invalid-column errors and injection risk.
- Row updates detect the real primary key and only auto-touch `updated_at` when that column exists on the target table.
