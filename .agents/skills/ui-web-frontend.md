# Skill: UI Web Development

Use this skill for building high-density, professional dashboards using React and Vanilla CSS.

> **PREREQUISITE**: Read `.agents/rules/design-system.md` FIRST. It catalogs every reusable CSS class. Inline `style={{}}` is banned unless no class matches.

## Operational Rules

1.  **Design System First**: Use established CSS tokens (`--bg`, `--surface`, `--accent`). Never write raw hex colors or px values for spacing/radius/font when a CSS class exists.
2.  **Micro-Animations**: All interactive elements must have hover/active states and subtle fade-ins.
3.  **Consistency**: Use the `showDateTime` utility for all timestamps (24h clock, no seconds, no AM/PM).

## Implementation Flow

1.  **Layout**:
    - Use `.stack-layout` for vertical grouping.
    - Use `.toolbar-panel` for action rows (Left: Pagination | Right: Search/Create).
2.  **Components**:
    - Always check the shared component catalog first before writing inline code.
    - Use `useSortableTable` hook for table sorting.
    - Group metrics in high-density cards for the dashboard.
3.  **Styling**:
    - Apply `fadeIn` classes to new panels.
    - Ensure 100% responsiveness (test Mobile vs. Desktop).

## Shared Component Catalog

Use these instead of writing inline patterns. All in `web-ui/src/components/`.

### Layout

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| `MasterDetailLayout` | `MasterDetailLayout.jsx` | `sidebar`, `children` | CronPage, ProvidersPage, SettingsPage, AccountsV2Page, CachePage |
| `PageGate` | `PageGate.jsx` | `loading`, `error`, `empty`, `emptyText`, `children` | All pages (loading/error/empty state wrapper) |

### Navigation & Tabs

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| `SidebarListItem` | `SidebarListItem.jsx` | `name`, `label`, `status`, `active`, `onClick` | CronPage, ProvidersPage, SettingsPage, AccountsV2Page |
| `TabBar` | `TabBar.jsx` | `tabs: [{key, label}]`, `activeKey`, `onChange` | Any page with tab navigation |

### Data Display

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| `PaginationBar` | `PaginationBar.jsx` | `total`, `page`, `pages`, `pageSize`, `onPageChange`, `onPageSizeChange` | TradesPage, UsersPage, SnapshotsPage, DatabasePage, LogsPage |
| `SearchFilterBar` | `SearchFilterBar.jsx` | `searchValue`, `onSearchChange`, `filters: [{key, label, options}]`, `onFilterChange` | UsersPage, DatabasePage |
| `EmptyState` | `EmptyState.jsx` | `message`, `icon` | Any page (empty state display) |
| `KpiCard` | `KpiCard.jsx` | `label`, `value`, `hint`, `trend` | DashboardPage |
| `PnlDisplay` | `PnlDisplay.jsx` | `value` (number) | TradesPage, V2TradeDetailPage |

### Trade / Signal

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| `SignalDetailCard` | `SignalDetailCard.jsx` | `mode`, `response`, `tradePlan`, `chart`, `bars` | TradesPage, V2TradeDetailPage, ChartSnapshotsPage |
| `TradePlanEditor` | `TradePlanEditor.jsx` | `value`, `onChange`, `onSave`, `onReset`, `enabled` | SignalDetailCard (internal) |
| `SymbolEntryCell` | `TradeSignalListCells.jsx` | `side`, `symbol`, `entry`, `tp`, `sl`, `rr`, `status` | TradesPage |
| `PositionAuditCell` | `TradeSignalListCells.jsx` | `source`, `strategy`, `timeText`, `sid`, `brokerId`, `confidence` | TradesPage |
| `StatusPnlCell` | `TradeSignalListCells.jsx` | `status`, `pnl`, `margin`, `statusNode` | TradesPage |
| `BrokerTicketBadge` | `BrokerTicketBadge.jsx` | `ticket`, `dispatchStatus` | TradesPage, V2TradeDetailPage |
| `AiTradeDetailCard` | `AiTradeDetailCard.jsx` | `trade`, `onUpdate`, `onCancel`, `onClose` | V2TradeDetailPage |
| `TradeFileUpload` | `TradeFileUpload.jsx` | `tradeId`, `disabled`, `showList`, `showLabel` | TradePlanEditor |
| `TradeFilesTab` | `TradeFilesTab.jsx` | `tradeId` | SignalDetailCard |

### Charts

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| `TradeSignalChart` | `TradeSignalChart.jsx` | `symbol`, `interval`, `entryPrice`, `slPrice`, `tpPrice` | SignalDetailCard |
| `TradeLevelChart` | `TradeLevelChart.jsx` | `symbol`, `live`, `entryPrice`, `slPrice`, `tpPrice` | SignalDetailCard |
| `InfoTabChart` | `InfoTabChart.jsx` | `symbol`, `timeframe`, `bars` | SignalDetailCard |

### Actions & Feedback

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| `ConfirmDialog` | `ConfirmDialog.jsx` | `open`, `title`, `message`, `confirmLabel`, `danger`, `onConfirm`, `onCancel` | All pages (replaces `window.confirm`) |
| `ToastContainer` | `ToastContainer.jsx` | (global — `showToast()`) | App.jsx |
| `NotificationDot` | `NotificationDot.jsx` | `active`, `count` | SidebarListItem, TickerBar |
| `NotificationWatcher` | `NotificationWatcher.jsx` | (global — SSE listener) | App.jsx |

### Utilities

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| `SessionClockBar` | `SessionClockBar.jsx` | `displayTimezone` | App.jsx |
| `TickerBar` | `TickerBar.jsx` | (global) | App.jsx |
| `SmartContent` | `SmartContent.jsx` | `content`, `maxHeight` | SignalDetailCard |
| `ImageViewer` | `ImageViewer.jsx` | `src`, `alt`, `onClose` | SnapshotsPage, SignalDetailCard |
| `SizeCalculator` | `SizeCalculator.jsx` | `entry`, `sl`, `balance`, `riskPct`, `onVolumeChange` | TradePlanEditor |
| `AdvancedOrderPanel` | `AdvancedOrderPanel.jsx` | `symbol`, `entry`, `tp`, `sl`, `direction` | ChartSnapshotsPage |
| `UserDetailSection` | `UserDetailSection.jsx` | `user`, `accounts`, `onUpdate`, `onDelete` | UsersPage |

## Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useSortableTable` | `hooks/useSortableTable.js` | Sort state, toggleSort, sortMarker, sorted rows |

## Shared Utils

Use these instead of local wrapper functions. All in `web-ui/src/utils/`.

| Util | File | Exports |
|------|------|---------|
| `numberFormat` | `numberFormat.js` | `asNum`, `asMoney`, `asMoneySigned`, `asPct`, `asRR`, `moneyClass` |
| `textList` | `textList.js` | `parseTextList`, `symbolsToText` |
| `secrets` | `secrets.js` | `maskSecretPreview` |
| `tradeRow` | `tradeRow.js` | `brokerTicketOf`, `tradeKeyOf`, `asFiniteOrNull`, `fDateTime` |
| `tradePlanShape` | `tradePlanShape.js` | `isCurrentAiTradePlan`, `normalizePlanSymbol` |
| `signalDetailUtils` | `signalDetailUtils.jsx` | `formatTimeframe`, `toTradingViewSymbol`, detail header builder |

## Verification Checklist
- [ ] Read `.agents/rules/design-system.md` — no inline styles where CSS class exists
- [ ] Checked shared component catalog before writing new code
- [ ] Used `PaginationBar` instead of inline pagination
- [ ] Used `ConfirmDialog` instead of `window.confirm()`
- [ ] Used `SidebarListItem` + `MasterDetailLayout` for sidebar layouts
- [ ] Used `PnlDisplay` for money display
- [ ] Used shared utils instead of local wrapper functions
- [ ] No `style={{ background: "var(--surface)" }}` — use `.panel` or `.card-flat`
- [ ] No `style={{ display: "flex", gap: ... }}` — use `.stack-layout` or `.toolbar-panel`
- [ ] No `style={{ color: "#10b981" }}` — use `.money-pos`
- [ ] No `style={{ color: "#ef4444" }}` — use `.money-neg` or `.msg-error`
- [ ] No inline styles on `<table>`, `<th>`, `<td>` — use `.table-dense`
- [ ] All buttons use button classes, never inline
- [ ] All loading/error/empty states use `.loading`, `.error`, `.empty-state`
- [ ] Matches CSS tokens
- [ ] Responsive at 375px
- [ ] No layout shifts
- [ ] Consistent time formatting
