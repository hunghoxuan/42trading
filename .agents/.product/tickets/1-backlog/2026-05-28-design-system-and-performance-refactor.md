# Ticket: Design System & Performance Refactor

## Status
- **PLANNING**
- Goal: Formalize existing CSS into a design system, add mobile-first responsive breakpoints, integrate headless table/virtual-scroll primitives, and replace hand-rolled modal/dropdown logic with accessible Radix UI primitives. Zero visual regression. No TypeScript.

## Scope

**In scope:** CSS tokens + utility classes, mobile responsive (topbar/tables/cards/charts), TanStack Table on all data pages, react-virtuoso on long lists, Radix Dialog/DropdownMenu/Tooltip, continue component extractions, new `EmptyState`/`FormGroup`/`AppShell` components.

**Out of scope:** TypeScript, chart library changes, backend changes, visual redesign, shadcn/ui or Ant Design, AG Grid.

---

## Phases

### Phase 0 — Dependencies & Token Foundation (2h)

Install: `@tanstack/react-table`, `react-virtuoso`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`.

Add design token block to `styles.css` — `--space-*`, `--radius-*`, `--text-*`, `--shadow-*`. Replace hardcoded pixel values with token references.

**Verify:** `npm --prefix web-ui run build`. Visual identical.

---

### Phase 1 — Mobile-First Responsive Shell (5h)

- New `AppShell.jsx`: hamburger + slide-out drawer nav on <768px, sticky topbar on >=768px.
- Responsive rules: hide topbar nav on mobile, `overflow-x: auto` on tables, single-column cards, 44px touch targets. Charts hidden <480px with "Open on desktop" fallback.
- Wire AppShell into `App.jsx`.

**Verify:** Chrome DevTools device toolbar — iPhone SE, iPad, 1920px. No horizontal overflow. Nav works on touch.

---

### Phase 2 — Token Migration & Utility Classes (6h)

Map all hardcoded values to tokens. Extract utility classes:

```css
.card-flat     { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); }
.card-dense    { padding: var(--space-md); }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-lg); }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-lg); }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-lg); }
.btn-base       { border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; }
.input-base     { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); padding: 8px 12px; }
.table-dense    { width: 100%; border-collapse: collapse; }
.table-dense th { background: var(--panel); font-size: 11px; font-weight: 800; text-transform: uppercase; padding: 12px; text-align: left; }
.table-dense td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
```

Apply where it simplifies, keep all existing component-specific class names.

**Verify:** Every page visually identical to before.

---

### Phase 3 — Radix UI Primitives (8h)

#### 3a. Dialog (3h)
Rewrite `ConfirmDialog.jsx` to use `@radix-ui/react-dialog` internally. Keep existing public API (`useConfirmDialog` hook, `ConfirmDialogProvider`). Map existing CSS classes onto Radix parts. Gains: focus trap, Escape key, ARIA `role="alertdialog"`, scroll lock.

#### 3b. DropdownMenu (3h)
New `NavDropdown.jsx` wrapping `@radix-ui/react-dropdown-menu`. Replace CSS-hover `.nav-dropdown` in topbar. Gains: touch device support, keyboard arrow navigation, ARIA menu roles.

#### 3c. Tooltip (2h)
New `Tooltip.jsx` wrapping `@radix-ui/react-tooltip`. Add to: table cell truncation, broker ticket badges, account KPI cards, chart timeframe pills, topbar icons.

**Verify:** Keyboard nav (Tab/Enter/Escape/arrows). Screen reader reads dialog + menu. Touch works.

---

### Phase 4 — TanStack Table (12h)

New `DataTable.jsx` wrapping `@tanstack/react-table`. Headless — renders `<table className="table-dense">` with `flexRender`. Respects existing CSS. Migrate 7 pages one-by-one:

| Page | Columns | Complexity |
|---|---|---|
| TradesPage | ~12 | High (custom cells) |
| LogsPage | ~6 | Low |
| DatabasePage | ~8 | Medium |
| UsersPage | ~10 | Medium |
| SnapshotsPage | ~5 | Low |
| EventsPage | ~6 | Low |
| CachePage | ~4 | Low |

For each: define TanStack column defs → replace `toggleSort`/`sortMarker` → replace manual sorting → remove old `useSortableTable` hook after last page.

**Verify:** Sort each column asc/desc. Filter still works. Pagination still works. Build pass after each page.

---

### Phase 5 — react-virtuoso (4h)

Wrap DataTable rows in `<Virtuoso>` on pages with 1000+ potential rows: Trades, Logs, Events, Snapshots, Database. Use `fixedItemHeight` for uniform rows. `overscan` default. Keep existing pagination.

**Verify:** Load 10K rows → scroll to bottom instantly. DOM nodes <200 regardless of data size.

---

### Phase 6 — Component Extractions (6h)

Continue from `2026-05-28-extract-reusable-components.md`, prioritized:

1. **PaginationBar** — 5 copies, low risk
2. **MasterDetailLayout** — 4 copies, low risk
3. **SidebarListItem** — 4 copies, low risk
4. **TabBar** — 5 copies, low risk
5. **EmptyState** — new, 8+ copies
6. **FormGroup** — new, label+input spacing
7. **SearchFilterBar** — 6 copies, medium (start with shell + search only)

Defer `useSortableTable` and `TradeDetailPanel` (replaced by TanStack Table).

**Verify:** Each extracted component renders identically on original page.

---

## Acceptance Criteria

- [ ] Design tokens defined + used. All hardcoded spacing/radius/font values → tokens.
- [ ] Utility classes (`.card-flat`, `.grid-*`, `.btn-base`, `.input-base`, `.table-dense`) defined + applied.
- [ ] Mobile <768px: hamburger nav, scrollable tables, stacked cards, full-width forms.
- [ ] Mobile <480px: charts hidden with fallback, 44px touch targets, reduced padding.
- [ ] Desktop >=768px: visually identical to current. No layout shift. No style breakage.
- [ ] `@radix-ui/react-dialog`: all 14 destructive-action confirms work. Keyboard accessible.
- [ ] `@radix-ui/react-dropdown-menu`: nav dropdowns work on touch + keyboard + mouse.
- [ ] `@radix-ui/react-tooltip`: tooltips appear on hover for truncation/badge/icon targets.
- [ ] TanStack Table: sort + filter + pagination on all 7 migrated pages.
- [ ] react-virtuoso: 10K+ rows scroll without jank, DOM node count bounded.
- [ ] Component extractions: 7 components extracted with no visual change.
- [ ] `npm --prefix web-ui run build` passes. Diagnostics clean.
- [ ] Dark/light theme toggle still works on every page.

---

## Constraints
- Zero visual regression. Every page looks identical to current on desktop.
- No breaking changes to existing CSS class names.
- No TypeScript — JSX only.
- No backend changes.
- Keep `lightweight-charts` untouched.
- Each phase independently buildable and deployable.

## Dependencies Added
- `@tanstack/react-table` (~15 KB)
- `react-virtuoso` (~15 KB)
- `@radix-ui/react-dialog` (~5 KB)
- `@radix-ui/react-dropdown-menu` (~6 KB)
- `@radix-ui/react-tooltip` (~3 KB)
- **Total: ~44 KB gzipped**

## Related
- Feature Doc: `../features/web-ui/design_system_and_performance_refactor.md`
- Prerequisite Audit: `./2026-05-28-extract-reusable-components.md`
