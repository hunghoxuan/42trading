# UI Rules

> Single source of truth for UI behavior, design language, and consistency in this project.
> Follow this before writing JSX/CSS or changing layout behavior.

---

## Core Visual Direction

- Build for a trading/admin product: dense, readable, purposeful.
- Dark theme is primary.
- Light theme must stay muted: soft gray-blue surfaces, never pure white cards/forms.
- Use one visual system across cards, forms, tables, logs, and charts.
- Prefer calm, compact UI over decorative UI.
- Avoid extra borders inside already bordered containers unless they add meaning.

---

## Layout Rules

- Desktop:
  - keep related controls on the same row
  - avoid unnecessary wrapping
  - keep header/toolbar rows stable and aligned
  - use compact spacing, but never let controls overlap
- Mobile:
  - inputs, selects, buttons, and combos should usually be full width
  - large panels should collapse by default unless there is a strong reason not to
  - one chart per row
  - avoid full-screen drawers when outside-tap close is expected

---

## Spacing Rules

- Use a small, consistent spacing scale.
- Keep padding/gap behavior uniform inside a given panel.
- Fix container spacing first when a layout looks wrong.
- Do not mix multiple padding systems on the same screen.
- Keep header rows padded enough to breathe, but still compact.

---

## Typography Rules

- Prefer short, explicit labels.
- Use uppercase sparingly for section labels and compact headings.
- Remove redundant wording when the meaning is already clear.
- Use plain text when a badge is not necessary.
- Use smaller, muted text for secondary details.
- Keep status labels readable, not loud.

## Time Emphasis Rules

- Time-based labels should use shared opacity semantics instead of ad hoc inline styles.
- `now`, `future`, `current`, `normal`, `active`, `major` → opacity 100
- `past`, `ago`, `inactive`, `disabled`, `readonly`, `minor` → opacity 80
- Apply those states with utility classes, not custom JSX opacity values, when the text is time-related or time-adjacent.

Recommended utility classes:
- `.time-now`, `.time-future`, `.time-current`, `.time-normal`, `.time-active`, `.time-major`
  - opacity 100
- `.time-past`, `.time-ago`, `.time-inactive`, `.time-disabled`, `.time-readonly`, `.time-minor`
  - opacity 80

---

## Color Rules

- Green: profit, success, active, online.
- Red: loss, error, destructive.
- Amber: pending, open, in-progress, warning.
- Blue: informational or primary-active.
- Muted gray: neutral, disabled, inactive, cancelled.
- Use color to communicate meaning, not decoration.

### Status Semantics

- `filled`, `open` → accent color `var(--accent)`
- `pending`, `info` → yellow `rgb(245, 158, 11)`
- `win`, `positive`, `active`, `ok`, `done`, `success` → green `#10b981`
- `lose`, `negative`, `error`, `fail`, `rejected` → red `#ef4444`
- `inactive`, `disabled`, `cancelled`, `cancel`, `offline`, `neutral` → muted gray

Use these semantics consistently for text, badges, dots, counts, and summary values.

Recommended utility classes:
- `.status-accent`, `.status-filled`, `.status-open`
- `.status-warn`, `.status-pending`, `.status-info`
- `.status-success`, `.status-win`, `.status-positive`, `.status-active`, `.status-ok`, `.status-done`
- `.status-danger`, `.status-lose`, `.status-negative`, `.status-error`
- `.status-neutral`, `.status-inactive`, `.status-disabled`, `.status-cancelled`, `.status-offline`

---

## Control Rules

- Buttons, inputs, and selects should share a consistent height rhythm.
- Desktop controls should remain compact.
- Mobile controls should remain easy to tap.
- Toggle and collapse buttons should live in the relevant header row.
- Modal dismiss actions must always be visible and clear.
- Menus should close after selection on mobile.
- Clicking the brand/title may also close the menu on mobile when useful.

---

## Navigation Rules

- Desktop navigation should stay calm and compact.
- Mobile navigation should expose important identity controls, but not crowd the header.
- Mobile drawers should not occupy the full screen unless absolutely necessary.
- Clicking a nav item should close the mobile menu.

---

## Dashboard Rules

- Keep the KPI strip in one clean row on desktop.
- The dashboard total should represent meaningful trade states, not raw rows.
- Prefer explicit status names over abbreviations in titles and cards.
- Put `All times` last when it is part of a period strip.
- Remove noisy ratio labels when they do not add value.
- The new first period card should represent filled/open positions if the data supports it.

---

## Trades Rules

- Page title should reflect the active status explicitly:
  - `Filled Trades (Positions)`
  - `Pending Trades (Orders)`
  - `Closed Trades`
  - `Draft Trades`
- The filter panel must be collapsible on mobile.
- The list header should keep pagination and the collapse toggle in the same row.
- The collapse toggle belongs inside the pager/header area.
- Keep trades toolbars and filters dense but readable.

---

## Logs Rules

- Logs are text-first.
- Keep the `Message` column readable and not badge-heavy.
- Keep `Info` as plain text.
- Reduce visual weight of log type labels in the time/message columns.
- Prefer wider info columns over nested pills or secondary controls.

---

## Cron / Settings Rules

- Keep status actions simple:
  - no extra instructional text if the state is obvious
  - use short action labels like `SAVE`
- Show a small, consistent status dot for active/inactive states.
- Keep action buttons in the same row when possible.
- Always include a clear cancel/close action for modals.

---

## Tables & Lists

- Tables should be dense and readable.
- Header rows must stay aligned with body rows.
- Use text emphasis before using extra pills/badges.
- Selected/active rows should be obvious, but not visually noisy.
- Log tables should prioritize readable text and compact metadata.

---

## Reusable Utility Classes

Use these shared classes before inventing new one-off styling:

- `.app-shell`, `.app-container`, `.page-wrap`
  - page/app wrappers
- `.stack-layout`
  - vertical layout with consistent spacing
- `.panel`, `.card-flat`, `.card-dense`
  - consistent card surfaces
- `.toolbar-panel`, `.toolbar-group`
  - shared header/filter/action rows
- `.pager-area`
  - pagination/count/toggle row content
- `.mobile-collapse-section`
  - collapsible mobile panels for filters/forms
- `.summary-item`
  - compact KPI/value block
- `.panel-label`
  - section heading / label
- `.minor-text`, `.cell-major`, `.cell-minor`, `.cell-wrap`
  - compact typography and multi-line content
- `.table-dense`, `.events-table-wrap`
  - dense table rendering
- `.money-pos`, `.money-neg`, `.money-neutral`
  - PnL coloring
- `.status-dot`
  - small status indicator dot
- `.time-now`, `.time-future`, `.time-current`, `.time-normal`, `.time-active`, `.time-major`
  - time emphasis at full opacity
- `.time-past`, `.time-ago`, `.time-inactive`, `.time-disabled`, `.time-readonly`, `.time-minor`
  - time emphasis at reduced opacity
- `.badge`
  - use only for true status chips or compact semantic tags
- `.primary-button`, `.secondary-button`, `.danger-button`, `.icon-button`
  - consistent button variants

---

## Inline Style Rule

- Prefer shared classes and reusable components first.
- Inline styles are acceptable only when:
  - the value is dynamic and data-driven
  - the layout has no existing reusable class
  - the change is truly local and one-off
- Don’t add one-off inline styles for spacing, size, borders, typography, or colors if a shared class exists.
- Avoid ad hoc inline styles in JSX for anything repeated across screens.
- If a visual pattern appears more than once, add a class instead of copying style objects.
- If a status/color/size/alignment rule is needed, prefer a semantic class or modifier class.
- In short: class first, inline style last.

## Implementation Reminder

- When editing UI code, try to convert ad hoc `style={{}}` usage into reusable classes.
- If you need to color status text, use the status utility classes from this file.
- If you need time emphasis, use the time utility classes from this file.
- If you need layout spacing or alignment, prefer `.stack-layout`, `.toolbar-panel`, `.toolbar-group`, `.pager-area`, or a new shared class.
- If you need a one-off style, keep it minimal and explain why it cannot be a class.
