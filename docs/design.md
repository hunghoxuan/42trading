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

## List Rules

- Use `ListItems` for repeated scrollable lists.
- Do not create one-off scroll wrappers with inline `overflow`, `padding`, `background`, or scrollbar styling if `ListItems` fits.
- If a list needs a custom height or gap, keep the override minimal and local.

## Card Rules

- Repeated list rows should use `.card-item`.
- Selected rows should add `.selected-item`.
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
  - `ResponsivePanel`
- If a pattern repeats on more than one screen, extract it into a shared component or shared class immediately.
