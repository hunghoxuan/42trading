# Design System — CSS Class Reference

> **MANDATORY:** Before writing ANY inline `style={{}}` in a JSX component, scan this catalog. If a class exists for your need, use it. Inline styles are only allowed when no class matches or for dynamic values (e.g., width from data).

---

## Global Tokens (use in CSS, not inline)

```css
--bg             /* page background */
--surface        /* card/panel background */
--panel          /* elevated surface (inputs, table headers) */
--border         /* all borders */
--text           /* primary text */
--text-inverse   /* text on accent bg */
--muted          /* secondary/subdued text */
--accent         /* primary accent color */
--accent-soft    /* accent at 10% opacity (hover states) */
```

---

## Layout

| Class | Rule | Use instead of |
|---|---|---|
| `.app-container` | `padding: 20px; width: 100%` | Page wrapper |
| `.app-shell` | Same as container | App-level wrapper |
| `.page-wrap` | `width: 100%` | Full-width page |
| `.stack-layout` | `display: flex; flex-direction: column; gap: 18px` | `style={{ display: "flex", flexDirection: "column", gap: 18 }}` |
| `.dashboard-grid` | 3-col grid | Dashboard layouts |

### Grid Helpers

| Class | Rule | Use instead of |
|---|---|---|
| `.grid-2` | `grid-template-columns: repeat(2, 1fr); gap: 16px` | Inline grid |
| `.grid-3` | `grid-template-columns: repeat(3, 1fr); gap: 16px` | Inline grid |
| `.grid-4` | `grid-template-columns: repeat(4, 1fr); gap: 16px` | Inline grid |

---

## Cards & Panels

| Class | Rule |
|---|---|
| `.panel` | `background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px` |
| `.card-flat` | Same as `.panel` — use for generic card wrappers |
| `.card-dense` | `.card-flat` + `padding: 12px` — compact variant |

### Typical pattern:

```jsx
{/* ✅ DO */}
<div className="panel">
  <div className="panel-label">SETTINGS</div>
  ...
</div>

{/* ❌ DON'T */}
<div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
```

---

## Section Labels

| Class | Rule |
|---|---|
| `.panel-label` | `color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px` |

---

## Buttons

| Class | Rule | Use for |
|---|---|---|
| `.primary-button` | Accent-filled | Create, Save, Apply, Submit |
| `.secondary-button` | Transparent + border | Cancel, Edit, navigation, utility |
| `.danger-button` | Red bordered | Delete, Archive, destructive actions |
| `.icon-button` | Compact 30×28 | Icon-only buttons |
| `.btn-busy` | Disabled-look | Button during async operation |

### State classes on buttons:

| Class | Apply when |
|---|---|
| `.active` | Button represents current/toggled state |
| `disabled` attr | Action not available |

```jsx
{/* ✅ DO */}
<button className="primary-button" disabled={submitting}>
  {submitting ? <span className="spinner" /> : "Save"}
</button>

{/* ❌ DON'T */}
<button style={{ background: "var(--accent)", color: "var(--text-inverse)", ... }}>
```

---

## Forms

| Class | Rule |
|---|---|
| `input`, `select`, `button` | Global base styles already applied by tag selector |
| `.form-message` | Helper/error text below form (12px, bold) |
| `.field-validation` | Field-level validation (11px, bold) |
| `.error-inline` | Red inline error (12px) |
| `.msg-error` | Red message |
| `.msg-warning` | Amber message |
| `.msg-success` | Green message |

### Form layout pattern:

```jsx
<div className="stack-layout">
  <div>
    <label className="panel-label">NAME</label>
    <input value={name} onChange={...} />
    {error && <div className="field-validation msg-error">{error}</div>}
  </div>
  <div className="form-message msg-error">Form-level error</div>
  <button className="primary-button">Save</button>
</div>
```

---

## Typography

| Class | Rule | Use for |
|---|---|---|
| `.page-title` | 28px, 800 weight | Page headings |
| `.kpi-value` | 24px, 400 weight | Large numbers |
| `.cell-major` | 12px, primary color | Table cell primary value |
| `.cell-minor` | 10px, muted color | Table cell secondary value |
| `.minor-text` | Same as `.cell-minor` | General subdued text |
| `.cell-wrap` | Flex column, 2px gap | Multi-line cell content |

---

## Money / PnL Colors

| Class | Rule |
|---|---|
| `.money-pos` | Green `#10b981` — profit |
| `.money-neg` | Red `#ef4444` — loss |
| `.money-neutral` | Muted — zero/neutral |

```jsx
{/* ✅ DO */}
<span className={pnl > 0 ? "money-pos" : "money-neg"}>{asMoney(pnl)}</span>

{/* ❌ DON'T */}
<span style={{ color: pnl > 0 ? "#10b981" : "#ef4444" }}>{asMoney(pnl)}</span>
```

---

## Status Indicators

| Class | Rule |
|---|---|
| `.status-dot` | 8×8 circle base |
| `.status-dot.online` | Green + glow |
| `.status-dot.idle` | Amber |
| `.status-dot.offline` | Red |

```jsx
<span className={`status-dot ${online ? "online" : "offline"}`} />
```

---

## Badges

| Class | Rule | Semantic |
|---|---|---|
| `.badge` | Base: 10px, 900 weight, 6px radius | Generic badge |
| `.badge.TP` / `.LIVE` / `.SUCCESS` | Green | Success / winning |
| `.badge.SL` / `.FAIL` / `.ERROR` / `.REJECTED` | Red | Error / losing |
| `.badge.START` / `.PROGRESS` | Blue | In progress |
| `.badge.OK` / `.PLACED` / `.ACTIVE` / `.LOCKED` / `.FILLED` / `.OPEN` | Amber | Active / pending |
| `.badge.INACTIVE` / `.DISABLE` / `.DISABLED` / `.FALSE` / `.OFFLINE` / `.CANCELLED` / `.CANCEL` | Gray | Inactive / disabled |
| `.badge.OTHER` / `.NEW` | Muted | Neutral / unknown |

```jsx
{/* ✅ DO */}
<span className={`badge ${status}`}>{status}</span>

{/* ❌ DON'T */}
<span style={{ borderRadius: 6, padding: "3px 10px", fontSize: 10, ... }}>{status}</span>
```

---

## Buy/Sell Side Badges

| Class | Rule |
|---|---|
| `.side-badge` | 18×18 colored square indicator |
| `.side-badge.side-buy` | Green B |
| `.side-badge.side-sell` | Red S |
| `.side-buy` | Green text |
| `.side-sell` | Red text |

```jsx
<span className={`side-badge ${side === "BUY" ? "side-buy" : "side-sell"}`}>
  {side === "BUY" ? "B" : "S"}
</span>
```

---

## Tables

| Class | Rule |
|---|---|
| `.table-dense` | `width: 100%; border-collapse: collapse` |
| `.table-dense th` | Panel bg, uppercase, 11px, 800 weight, 12px padding |
| `.table-dense td` | 8/12px padding, border-bottom |
| `.events-table` | Same as `.table-dense` (alias) |
| `.events-table tr:hover` | Row hover (accent-soft) |
| `.events-table tr.active` | Selected row (accent-soft) |
| `.events-table-wrap` | Scrollable table wrapper |
| `.selected-row` | Accent left border + bg highlight |
| `.compact-list` | Hides non-position/pnl columns for narrow views |

```jsx
{/* ✅ DO */}
<div className="events-table-wrap">
  <table className="table-dense">
    <thead>
      <tr><th>NAME</th><th>VALUE</th></tr>
    </thead>
    <tbody>
      {rows.map(r => <tr key={r.id}><td className="cell-major">{r.name}</td></tr>)}
    </tbody>
  </table>
</div>

{/* ❌ DON'T */}
<table style={{ width: "100%", borderCollapse: "collapse" }}>
  <th style={{ background: "var(--panel)", fontSize: 11, ... }}>...</th>
</table>
```

---

## Pagination

| Class | Rule |
|---|---|
| `.pager-area` | Flex row, 12px gap, muted text |
| `.pager-mini` | Compact variant, 8px gap |

```jsx
<div className="pager-area">
  <button className="secondary-button" onClick={prev}>← Prev</button>
  <strong>Page {page} of {pages}</strong>
  <button className="secondary-button" onClick={next}>Next →</button>
</div>
```

---

## Toolbar

| Class | Rule |
|---|---|
| `.toolbar-panel` | Flex toolbar container (surface bg, border, 12/20px padding) |
| `.toolbar-left` | Left group |
| `.toolbar-right` | Right group (margin-left: auto) |
| `.toolbar-separator` | 1px vertical divider |
| `.toolbar-group` | Grouped controls, 10px gap |

```jsx
<div className="toolbar-panel">
  <div className="toolbar-left">
    <div className="pager-mini">...</div>
  </div>
  <div className="toolbar-separator" />
  <div className="toolbar-right">
    <input placeholder="Search..." />
    <button className="primary-button">Create</button>
  </div>
</div>
```

---

## Loading / Error / Empty States

| Class | Rule |
|---|---|
| `.loading` | Centered, 40px padding, uppercase, muted |
| `.error` | Same + red color |
| `.empty-state` | Same, muted only |
| `.spinner` | 18×18 spinning circle |
| `.frozen-overlay` | Absolute overlay with spinner (use with `.component-frozen-wrap`) |
| `.fadeIn` | Subtle fade+slide animation (0.18s) |
| `.value-flash` | SSE real-time update pulse (0.8s) |

```jsx
{/* ✅ DO */}
{loading && <div className="loading">Loading...</div>}
{error && <div className="error">{error}</div>}
{!loading && !error && rows.length === 0 && <div className="empty-state">No data</div>}
```

---

## Component-Specific Classes

### Shared component classes — use when manual markup needed

| Class | Component |
|---|---|
| `.sidebar-item-v2` | Sidebar list item style |
| `.sidebar-item-v2.active` | Active sidebar item |
| `.status-badge` | Small status badge (2/6px padding) |
| `.status-badge.active` | Active accent badge |
| `.status-badge.inactive` | Inactive gray badge |

### Snapshot classes — use only in snapshot-related pages

| Prefix | Scope |
|---|---|
| `.snapshot-*` | All ~80 classes — snapshot builder/gallery/cards/forms/modal only |
| `.chart-*` | Chart wrapper/controls/timeframe pills |
| `.tf-pill`, `.tf-pills` | Timeframe selector buttons |
| `.mode-btn`, `.mode-toggles` | Display mode toggle |

### Component CSS files — scoped to one component only

| File | Scope |
|---|---|
| `SessionClockBar.css` | `.session-*`, `.ruler-*`, `.news-*`, `.marker-*` |
| `TickerBar.css` | `.ticker-*` |
| `ToastContainer.css` | `.toast-*` |

---

## When Inline Styles ARE Allowed

Only these cases:

1. **Dynamic values from data**: `style={{ width: `${pct}%` }}`, `style={{ left: `${pos}px` }}`
2. **One-off positioning**: `style={{ marginTop: 4 }}` (but prefer `.stack-layout` or grid gap)
3. **Grid column overrides**: `style={{ gridColumn: "span 2" }}` (or use `.snapshot-col-span-*`)
4. **Colors from data**: `style={{ color: row.color }}`
5. **Dimensions from props/canvas**: `style={{ height: chartHeight }}`

Even then, check if a **utility class** could achieve the same result first.

---

## Anti-Patterns (Never Do This)

```jsx
// ❌ Inline card
<div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>

// ❌ Inline button
<button style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>

// ❌ Inline badge
<span style={{ borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 900 }}>

// ❌ Inline flex layout
<div style={{ display: "flex", gap: 12, alignItems: "center" }}>

// ❌ Inline grid
<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>

// ❌ Hardcoded colors
<span style={{ color: "#10b981" }}>  {/* use .money-pos */}
<span style={{ color: "#ef4444" }}>  {/* use .msg-error or .money-neg */}
```

---

## Verification Checklist (Agent Self-Check)

Before marking a UI task complete:

- [ ] No `style={{ background: "var(--surface)" }}` — use `.panel` or `.card-flat`
- [ ] No `style={{ display: "flex", gap: ... }}` — use `.stack-layout` or `.toolbar-panel`
- [ ] No `style={{ display: "grid", gridTemplateColumns: ... }}` — use `.grid-*` or semantic grid class
- [ ] No `style={{ color: "#10b981" }}` — use `.money-pos`
- [ ] No `style={{ color: "#ef4444" }}` — use `.money-neg` or `.msg-error`
- [ ] No `style={{ borderRadius, padding, fontSize, fontWeight }}` on badges — use `.badge`
- [ ] No `style={...}` on `<table>`, `<th>`, `<td>` — use `.table-dense` or `.events-table`
- [ ] All buttons use `.primary-button`, `.secondary-button`, `.danger-button`, or `.icon-button`
- [ ] All loading/error/empty states use `.loading`, `.error`, `.empty-state`
- [ ] `npm --prefix web-ui run build` passes
