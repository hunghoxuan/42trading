# Feature: Design System & Performance Refactor

## User Flow
Professional trading UI with zero visual breakage on any screen size (320px phone to 4K monitor), instant table interactions, and a formalized reusable design system that replaces organically-grown CSS.

## Key Capabilities

### Design System Formalization
- **CSS Token Layer**: Extract current implicit values into explicit design tokens (`--space-*`, `--radius-*`, `--text-*`, `--shadow-*`). No visual change — just codify what's already there.
- **Utility Classes**: Extract the 80% repeated patterns into composable classes: `.card-flat`, `.card-dense`, `.grid-2`–`.grid-6`, `.btn-base`, `.input-base`, `.select-base`, `.table-dense`.
- **Mobile-First Breakpoints**: Add responsive rules at 480px/768px/1024px for all pages. Topbar collapses to hamburger. Tables get horizontal scroll. Detail cards stack single-column. Charts hide below 480px with "Open on desktop" message.
- **Design token docs**: Keep token definitions in `styles.css` with a comment header documenting usage. No separate doc file (single source of truth).

### Component Extraction (from existing audit)
- Continue the 8 repeated-pattern extractions from `2026-05-28-extract-reusable-components.md`:
  - PaginationBar, MasterDetailLayout, SidebarListItem, PageGate, TabBar
  - SearchFilterBar, ConfirmDialog (async modal replacing `window.confirm`)
  - useSortableTable, TradeDetailPanel
- **New**: Extract `EmptyState` component (repeated across system pages).
- **New**: Extract `FormGroup` wrapper for consistent label/input spacing.

### Performance: Headless Table & Virtual Scrolling
- **TanStack Table** (`@tanstack/react-table`): Replace all hand-rolled `sortKey`/`sortDir`/`filter` logic across Trades, Logs, Database, Users, Snapshots, Events, Cache pages. Headless — zero CSS conflict.
- **react-virtuoso**: Virtual scrolling for long lists (logs, events, trades list). Keeps DOM node count low regardless of row count.

### Accessibility: Radix UI Primitives
- **Dialog**: Replace `ConfirmDialog` (hand-rolled modal) with `@radix-ui/react-dialog`. Same CSS classes, same look. Gains: focus trap, Escape key, ARIA labels, scroll lock.
- **DropdownMenu**: Replace CSS-hover `nav-dropdown` with `@radix-ui/react-dropdown-menu`. Fixes: touch-device support (phones), keyboard navigation, screen reader accessibility.
- **Tooltip**: Add `@radix-ui/react-tooltip`. New capability. Used in: chart hover labels, broker ticket info, account metrics, table cell truncation hover.

### What Does NOT Change
- Keep `lightweight-charts` as-is.
- Keep all existing CSS custom properties (`--bg`, `--surface`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, `--accent-soft`).
- Keep dark/light theme toggle as-is.
- Keep all existing component CSS class names. Radix components layer UNDER existing classes.
- Keep all existing component logic (no behavior changes).
- Keep Vite + React 18 build.
- **No TypeScript in this ticket.** JSX only. TS migration is a separate future ticket.

## Technical Details
- **Frontend**: 
  - `src/ui/src/styles.css`: Add design token block, utility classes, and mobile breakpoints.
  - `src/ui/src/components/AppShell.jsx`: New top-level shell with hamburger menu for mobile.
  - `src/ui/src/components/DataTable.jsx`: New TanStack-powered table component.
  - `src/ui/src/components/ConfirmDialog.jsx`: Rewired to use `@radix-ui/react-dialog` internally.
  - `src/ui/src/components/EmptyState.jsx`: New reusable empty state.
  - `src/ui/src/components/FormGroup.jsx`: New form field wrapper.
- **New dependencies**: `@tanstack/react-table`, `react-virtuoso`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`.
- **Bundle impact**: ~40 KB gzipped total added. All tree-shakeable.
