# Ticket: DB & Cache Page Enhancements

## Meta
- ID: `FEAT-20260505-DB-CACHE-UI`
- Status: `DONE`
- Priority: `P2`

## Scope

### DB Page (`/system/db`)
1. Sorting on all column headers
2. Schema form: toggle display on List (true=show, false=hide in table view; detail always shows all)
3. Detail page: Edit + Save buttons for manual data editing
4. All UI generated dynamically from schema (no hardcoded forms)

### Cache Page (`/system/cache`)
1. Display updated time as "Xm ago" + expiry time
2. Search input for key + content search
3. Filter dropdown by symbol

### Docs
1. Update `db-schema.md` with trades table new fields
2. Update `db-schema.md` with any missing schema changes

## Files
- `web-ui/src/pages/system/DatabasePage.jsx`
- `web-ui/src/pages/system/CachePage.jsx`
- `.agents/.product/architecture/db-schema.md`
