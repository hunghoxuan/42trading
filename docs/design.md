# Design

## Goal

- Keep one consistent UI system across cards, lists, forms, tables, detail panes, and charts.
- Prefer shared wrappers and shared classes over ad hoc inline styling.
- Keep the UI dense, readable, and stable.

## Shared Primitives

- `ListItems`
  - Shared wrapper for vertically scrollable item lists.
  - Applies the `.list-items` class.
- `.list-items`
  - Shared list surface and scrollbar styling.
- `.card-item`
  - Shared card row styling for repeated list items.
- `.selected-item`
  - Shared selected-state border styling.
- `.form-item`
  - Shared styling for outer form shells only.
- `ResponsivePanel`
  - Shared panel shell for bordered/collapsible sections.

## Typography Roles

- `.ui-section-label`
  - Primary uppercase heading style for panel titles, list headers, and section labels.
  - `ResponsivePanel` titles should continue to map here through `.panel-label`.
- `.ui-field-label`
  - Uppercase micro-label for form fields.
  - Use this instead of raw `.minor-text` for field captions.
- `.ui-data-title`
  - Primary line for record names inside table cells and cards.
- `.ui-data-meta`
  - Secondary line for ids, subtitles, timestamps, and supporting metadata.
- `.ui-data-stack`
  - Shared vertical stack wrapper for a title + meta pair.

## List Rules

- Use `ListItems` for repeated scrollable lists.
- Do not create one-off scroll wrappers with inline `overflow`, `padding`, `background`, or scrollbar styling if `ListItems` fits.
- If a list needs a custom height or gap, keep the override minimal and local.
- Table headers, list headers, and form labels should all inherit from the same uppercase label family.
- Prefer `.ui-section-label` and `.ui-field-label` over ad hoc `fontSize`, `fontWeight`, `textTransform`, or muted color inline styles.

## Card Rules

- Repeated list rows should use `.card-item`.
- Selected rows should add `.selected-item`.
- Card titles and table cell titles should share `.ui-data-title`.
- Card subtitles and table cell secondary lines should share `.ui-data-meta`.
- Avoid inline overrides for shared card primitives:
  - `border`
  - `border-radius`
  - `padding`
  - `margin`
  - shared background colors

## Form Rules

- Use `.form-item` only for the outer form container.
- Do not apply `.form-item` to nested controls, input rows, or inner action groups.
- Inner fields should rely on shared control styling, not extra visual wrappers.
- Form labels should use `.ui-field-label`.
- Do not use `.minor-text` directly for field captions unless the text is truly auxiliary rather than the field label.

## Table Rules

- `DataTable` headers should visually align with `.ui-section-label` / `.ui-field-label`.
- Multi-line table cells should use:
  - `.ui-data-stack`
  - `.ui-data-title`
  - `.ui-data-meta`
- Selected rows and selected cards must use the same accent-driven selected state.

## Inline Style Policy

- Avoid inline styles for shared surface primitives, especially:
  - `border`
  - `border-radius`
  - `padding`
  - `margin`
  - shared list/card/form backgrounds
- Inline styles are acceptable for:
  - dynamic sizing
  - positioning
  - calculated layout
  - chart coordinates
  - truly data-driven values

## Reuse Rule

- Before creating a new wrapper, check:
  - `ListItems`
  - `.list-items`
  - `.card-item`
  - `.selected-item`
  - `.form-item`
  - `.ui-section-label`
  - `.ui-field-label`
  - `.ui-data-stack`
  - `.ui-data-title`
  - `.ui-data-meta`
  - `ResponsivePanel`
- If a pattern repeats on more than one screen, extract it into a shared component or shared class immediately.
