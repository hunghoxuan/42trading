# Ticket: Extract Reusable Components and Shared Helpers

## Status
- **PLANNING / AUDIT UPDATED**
- Current audit source: local worktree on 2026-05-28.
- Goal: find copy-pasted code patterns across files that should be shared, then implement extraction in small phases.

## Scope
Consolidate repeated UI and helper logic in `web-ui/src/` into shared components, hooks, or utilities.

Preferred shape:
- Shared UI components receive props or JSON-shaped data and do not own data fetching.
- Hooks own reusable state transitions only.
- Utilities own pure formatting/parsing logic only.
- Preserve current visuals and behavior.

Out of scope for this ticket:
- Backend route refactors.
- Trading behavior changes.
- Broad redesign.

Recent note:
- Broker ticket border/status rendering was already extracted into `web-ui/src/components/BrokerTicketBadge.jsx`; do not re-add that to this backlog unless new copies appear.

---

## Inline Pattern Audit: 8 Repeated Patterns

### 1. Pagination Bar

Repeated `pager-mini` block with previous/next buttons, page label, and page-size select.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/trades/TradesPage.jsx` | 930-958 |
| 2 | `web-ui/src/pages/system/LogsPage.jsx` | 217-238 |
| 3 | `web-ui/src/pages/system/DatabasePage.jsx` | 396-428 |
| 4 | `web-ui/src/pages/system/UsersPage.jsx` | 466-495 |
| 5 | `web-ui/src/pages/system/SnapshotsPage.jsx` | 289-294 |

Extract:
- `web-ui/src/components/PaginationBar.jsx`

Suggested props:
```ts
{
  page: number,
  pages: number,
  total?: number,
  pageSize?: number,
  pageSizeOptions?: number[],
  onPageChange: (page: number) => void,
  onPageSizeChange?: (pageSize: number) => void,
  compact?: boolean
}
```

Risk:
- Low. Mostly identical UI.
- Check whether each page stores page state in different objects (`filter`, standalone state, query params).

---

### 2. Master/Detail Sidebar Layout and Sidebar Item

Repeated two-column layout with `gridTemplateColumns: "280px 1fr"` and `sidebar-item-v2` buttons containing active/inactive dot, title, and minor label.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/settings/CronPage.jsx` | 535-541, 608-628 |
| 2 | `web-ui/src/pages/settings/ProvidersPage.jsx` | 339-345, 357-368 |
| 3 | `web-ui/src/pages/settings/SettingsPage.jsx` | 112-128, 321-327 |
| 4 | `web-ui/src/pages/system/AccountsV2Page.jsx` | 154-160, 170-187 |

Extract:
- `web-ui/src/components/MasterDetailLayout.jsx`
- `web-ui/src/components/SidebarListItem.jsx`

Suggested props:
```ts
// MasterDetailLayout
{
  sidebar: ReactNode,
  detail: ReactNode,
  sidebarWidth?: number | string,
  gap?: number
}

// SidebarListItem
{
  active?: boolean,
  enabled?: boolean,
  title: ReactNode,
  subtitle?: ReactNode,
  onClick?: () => void,
  rightSlot?: ReactNode
}
```

Risk:
- Low/medium. Layout is simple, but each page has slightly different header actions.

---

### 3. Raw `window.confirm()` for Destructive Actions

Repeated raw browser confirm calls. This creates inconsistent copy, no shared danger styling, and no async modal path.

| Copy | File | Lines | Action |
|---|---|---:|---|
| 1 | `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | 5243 | Delete template |
| 2 | `web-ui/src/pages/settings/CronPage.jsx` | 432 | Delete cron |
| 3 | `web-ui/src/pages/settings/ProvidersPage.jsx` | 305 | Delete provider settings |
| 4 | `web-ui/src/pages/settings/SettingsPage.jsx` | 212 | Delete setting |
| 5 | `web-ui/src/pages/system/AccountsV2Page.jsx` | 107 | Archive account |
| 6 | `web-ui/src/pages/system/CachePage.jsx` | 168 | Clear cache |
| 7 | `web-ui/src/pages/system/LogsPage.jsx` | 125 | Delete all events |
| 8 | `web-ui/src/pages/system/SnapshotsPage.jsx` | 179 | Delete one file |
| 9 | `web-ui/src/pages/system/SnapshotsPage.jsx` | 188 | Delete visible files |
| 10 | `web-ui/src/pages/system/StoragePage.jsx` | 41 | Cleanup storage |
| 11 | `web-ui/src/pages/system/UsersPage.jsx` | 296 | Deactivate user |
| 12 | `web-ui/src/pages/system/UsersPage.jsx` | 326 | Delete user/account data |
| 13 | `web-ui/src/pages/system/UsersPage.jsx` | 435 | Deactivate account |
| 14 | `web-ui/src/pages/trades/TradesPage.jsx` | 463 | Bulk delete trades |

Extract:
- `web-ui/src/components/ConfirmDialog.jsx`
- `web-ui/src/hooks/useConfirmDialog.js`

Suggested API:
```ts
const confirm = useConfirmDialog();
const ok = await confirm({
  title: "Delete cron?",
  message: "This cannot be undone.",
  confirmLabel: "Delete",
  tone: "danger"
});
```

Risk:
- Medium. Changes synchronous `window.confirm()` to async flow.
- Do this after adding the modal provider once, then migrate one page at a time.

---

### 4. Sortable Table State and Header Markers

Repeated `sortKey`, `sortDir`, `toggleSort()`, and `sortMarker()` logic, plus clickable `<th>` labels.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/DashboardPage.jsx` | 147-177, 209-253 |
| 2 | `web-ui/src/pages/trades/TradesPage.jsx` | 836-847, 1332-1347 |
| 3 | `web-ui/src/pages/system/DatabasePage.jsx` | 246-251, 359-364, 577-585 |

Extract:
- `web-ui/src/hooks/useSortableTable.js`
- Optional `web-ui/src/components/SortableHeader.jsx`

Suggested API:
```ts
const { sortedRows, sortKey, sortDir, toggleSort, sortMarker } =
  useSortableTable(rows, {
    initialKey: "created_at",
    accessors: { pnl: (row) => Number(row.pnl_realized || 0) }
  });
```

Risk:
- Medium/high. Sorting semantics differ by page and should be migrated cautiously.

---

### 5. Trade Detail Panel Wiring

Repeated `<Suspense fallback={<div className="loading-card">Loading Details...</div>}>` plus `SignalDetailCard` wiring, trade-plan props, chart props, and action buttons.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/trades/TradesPage.jsx` | 1558-1720 |
| 2 | `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | 563-639 |
| 3 | `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | 8151-8590 |

Extract:
- `web-ui/src/components/TradeDetailPanel.jsx`

Suggested props:
```ts
{
  trade: TradeRow,
  detailPlan: TradePlan,
  onPlanChange: (key: string, value: unknown) => void,
  onSavePlan?: () => Promise<void>,
  onAddTrade?: () => Promise<void>,
  chartConfig?: object,
  events?: unknown[],
  mode?: "route" | "side-panel" | "ai"
}
```

Risk:
- High. This is the most tangled copy.
- Requires agreeing on whether route-level pages or the panel own reload/navigation behavior.

---

### 6. Local Tab Button Groups

Repeated tab button markup: `secondary-button`, active ternary styles/classes, and inline `onClick` state setters.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | 6612-6674 |
| 2 | `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | 7328-7387 |
| 3 | `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | 8608-8750 |
| 4 | `web-ui/src/pages/tools/ToolsPage.jsx` | 49-85 |
| 5 | `web-ui/src/components/TradePlanEditor.jsx` | 1006-1040 |

Extract:
- `web-ui/src/components/TabBar.jsx`
- Optional `SegmentedButtonGroup.jsx` if some are action groups rather than tabs.

Suggested props:
```ts
{
  value: string,
  options: Array<{ value: string, label: ReactNode, disabled?: boolean }>,
  onChange: (value: string) => void,
  size?: "sm" | "md"
}
```

Risk:
- Low/medium. Mostly visual consistency, but some “tabs” are actually command buttons.

---

### 7. Loading/Error/Empty Gates

Repeated page-level loading and error guards, often with slightly different wrapper classes.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/DashboardPage.jsx` | 409-410 |
| 2 | `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | 478-479 |
| 3 | `web-ui/src/pages/settings/CronPage.jsx` | 513-529 |
| 4 | `web-ui/src/pages/system/DatabasePage.jsx` | 486-611 |
| 5 | `web-ui/src/pages/system/UsersPage.jsx` | 576-691 |
| 6 | `web-ui/src/pages/system/StoragePage.jsx` | 88-89 |
| 7 | `web-ui/src/pages/system/CachePage.jsx` | 410-416 |
| 8 | `web-ui/src/components/SignalDetailCard.jsx` | 2066, 3234, 3514 |

Extract:
- `web-ui/src/components/PageGate.jsx`
- `EmptyState.jsx` for table/body empties.

Suggested props:
```ts
{
  loading?: boolean,
  error?: ReactNode,
  empty?: boolean,
  loadingText?: ReactNode,
  emptyText?: ReactNode,
  children: ReactNode
}
```

Risk:
- Low. Start with route-level loading/error returns before table empty states.

---

### 8. Search / Filter Toolbars

Repeated toolbar with search input, selects, refresh buttons, and compact filter state updates.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/trades/TradesPage.jsx` | 974-1100 |
| 2 | `web-ui/src/pages/system/LogsPage.jsx` | 255-297 |
| 3 | `web-ui/src/pages/system/UsersPage.jsx` | 498-528 |
| 4 | `web-ui/src/pages/system/DatabasePage.jsx` | 438-474 |
| 5 | `web-ui/src/pages/system/SnapshotsPage.jsx` | 301-320 |
| 6 | `web-ui/src/pages/system/CachePage.jsx` | 221-240 |

Extract:
- `web-ui/src/components/SearchFilterBar.jsx`

Suggested props:
```ts
{
  search?: {
    value: string,
    placeholder?: string,
    onChange: (value: string) => void
  },
  filters?: Array<{
    key: string,
    value: string,
    options: Array<{ value: string, label: ReactNode }>,
    onChange: (value: string) => void
  }>,
  actions?: ReactNode
}
```

Risk:
- Medium. Layout is similar but filter shapes vary. Start by extracting only the shell and search field.

---

## Function Duplicate Audit: 8 Shared Helper Candidates

These are exact or effectively exact logic duplicates across files. Extract to shared utilities/components and import from the callers.

### 1. `fDateTime`

Logic: wrapper around `showDateTime(v)`.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/trades/TradesPage.jsx` | 55-57 |
| 2 | `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | 58-60 |
| 3 | `web-ui/src/pages/system/DatabasePage.jsx` | 22-24 |
| 4 | `web-ui/src/pages/system/LogsPage.jsx` | 6-8 |

Action:
- Delete local wrappers and import/use `showDateTime` directly, or export `formatDetailDateTime` from `utils/signalDetailUtils.jsx` consistently.

---

### 2. `PnlDisplay`

Logic: format a numeric PnL value, render `-` when null, and apply `money-neg`/`money-pos`.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/trades/TradesPage.jsx` | 275-284 |
| 2 | `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | 23-32 |

Action:
- Extract `web-ui/src/components/PnlDisplay.jsx`.

Suggested props:
```ts
{ value: number | string | null, empty?: ReactNode, strong?: boolean }
```

---

### 3. `brokerTicketOf`

Logic: use `broker_trade_id`, fallback to `ticket`, trim, else `-`.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/trades/TradesPage.jsx` | 115-117 |
| 2 | `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | 43-45 |

Action:
- Extract `getBrokerTicket(row)` to `web-ui/src/utils/tradeRow.js`.

---

### 4. `asFiniteOrNull`

Logic: convert with `asNum`, return finite number or `null`.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/trades/TradesPage.jsx` | 132-135 |
| 2 | `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | 67-70 |

Action:
- Move to `web-ui/src/utils/signalDetailUtils.jsx` next to `asNum`, or create `utils/number.js`.

---

### 5. `parseTextList`

Logic: split by newline/comma, trim, optional uppercase, de-dupe with `Set`, drop blanks.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/settings/SettingsPage.jsx` | 24-36 |
| 2 | `web-ui/src/pages/settings/CronPage.jsx` | 98-110 |

Action:
- Extract `parseTextList(value, { uppercase?: boolean })` to `web-ui/src/utils/textList.js`.

---

### 6. `maskSecretPreview`

Logic: show empty string for blank, mask short secrets with first/last char, longer secrets with first/last four chars.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/pages/settings/SettingsPage.jsx` | 76-81 |
| 2 | `web-ui/src/pages/settings/ProvidersPage.jsx` | 58-63 |

Action:
- Extract `maskSecretPreview(value)` to `web-ui/src/utils/secrets.js`.

---

### 7. `isCurrentAiTradePlan`

Logic: object guard for current AI trade-plan schema with `execution_plan` and plan identity fields.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/components/SignalDetailCard.jsx` | 208-220 |
| 2 | `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | 1044-1056 |

Action:
- Extract to `web-ui/src/utils/tradePlanShape.js`.

---

### 8. `formatNum3`

Logic: coerce numeric value, reject non-finite, trim to max 8 decimals.

| Copy | File | Lines |
|---|---|---|
| 1 | `web-ui/src/utils/signalDetailUtils.jsx` | 190-195 |
| 2 | `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | 62-66 |
| 3 | `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | 690-694 |
| 4 | `web-ui/src/components/TradePlanEditor.jsx` | 94-97 |

Action:
- Keep the implementation in `signalDetailUtils.jsx` or move to `utils/numberFormat.js`.
- Import everywhere else.

Risk:
- Low, but `TradePlanEditor.jsx` currently uses `String(Number(v.toFixed(8)))` without coercing first; verify no behavior depends on accepting only numbers.

---

## Implementation Order

### Phase 0 — Guardrails / Setup

Effort: low.

1. Add a small shared folder policy:
   - `components/` for presentational UI.
   - `hooks/` for reusable state.
   - `utils/` for pure logic.
2. Add snapshot-ish before/after screenshots for changed pages when doing UI extractions.
3. Avoid bundling multiple visual refactors in one commit.

### Phase 1 — Pure Helpers, Lowest Risk

Effort: low. No JSX layout changes except `PnlDisplay`.

1. Extract `fDateTime` away by using `showDateTime` directly.
2. Extract `brokerTicketOf` to `getBrokerTicket`.
3. Extract `asFiniteOrNull`.
4. Extract `parseTextList`.
5. Extract `maskSecretPreview`.
6. Extract/import `formatNum3`.
7. Extract `isCurrentAiTradePlan`.
8. Extract `PnlDisplay`.

Verification:
- `npm --prefix web-ui run build`
- Smoke check `/trades`, `/trades/{sid}`, `/settings`, `/settings/providers`, `/system/logs`.

### Phase 2 — Small Presentational Components

Effort: low/medium.

1. `PaginationBar`
2. `SidebarListItem`
3. `MasterDetailLayout`
4. `PageGate`
5. `TabBar`

Verification:
- Build.
- Visual check pages using each component.
- Confirm keyboard/click behavior unchanged.

### Phase 3 — Medium UI Composition

Effort: medium.

1. `SearchFilterBar`
2. `ConfirmDialog` + `useConfirmDialog`

Notes:
- `ConfirmDialog` changes sync `window.confirm` to async modal flow. Migrate one destructive action first, then the rest.
- `SearchFilterBar` should start with a shell plus `search` prop; do not try to over-generalize every select on first pass.

Verification:
- Build.
- Exercise delete/archive flows with cancel and confirm.
- Exercise each migrated filter input/select.

### Phase 4 — Higher-Risk Shared Behavior

Effort: high.

1. `useSortableTable`
2. `SortableHeader`
3. `TradeDetailPanel`

Notes:
- Sorting has subtle page-specific accessors and default orders.
- `TradeDetailPanel` touches live trading/editing workflows and should be last.
- Keep `TradeDetailPanel` props data-shaped. The panel should render and dispatch callbacks, not fetch its own data.

Verification:
- Build.
- Manual smoke for:
  - `/trades`
  - `/trades/{sid}`
  - AI trade detail panel in `ChartSnapshotsPage`
  - Dashboard sorting
  - Database sorting

---

## Acceptance Criteria

- [ ] The 8 inline patterns above are extracted or intentionally waived with rationale.
- [ ] The 8 function duplicates above are extracted or intentionally waived with rationale.
- [ ] Each extraction has a narrow diff and preserves current UI.
- [ ] Build passes after every phase.
- [ ] Trading detail routes still render the same trade data and do not change broker/dispatch behavior.
- [ ] Shared components receive props/data and avoid direct API calls unless explicitly documented.
