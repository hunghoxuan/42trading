# UI System

## Purpose

This file defines the semantic presentation classes we use for admin lists, tables, cards, and forms.

The goal is simple:

- one label system
- one record title/meta system
- one selected-state language

## Label Family

- `.ui-section-label`
  - Use for panel titles, list titles, and section headers.
  - Uppercase, muted, dense, and consistent with `ResponsivePanel`.
- `.ui-field-label`
  - Use for form field labels.
  - Same family as section labels, but tuned for tighter spacing above controls.

Notes:

- `ResponsivePanel` currently renders `.panel-label`; that class should remain visually aligned with `.ui-section-label`.
- Table headers should match this same uppercase label family.

## Data Text Family

- `.ui-data-stack`
  - Wrap a primary line plus a supporting line.
- `.ui-data-title`
  - Primary record text for rows and cards.
- `.ui-data-meta`
  - Secondary record text for ids, subtitles, locations, timestamps, and helper metadata.

Recommended row pattern:

```jsx
<div className="ui-data-stack">
  <strong className="ui-data-title">Record Name</strong>
  <span className="ui-data-meta">RECORD_ID</span>
</div>
```

## Selection States

- Table rows and card items should use the same accent-driven selected treatment.
- If an item is selectable, the selected state should be visible without opening the detail pane.

## When To Use What

- Form caption above an input: `.ui-field-label`
- Panel or list title: `.ui-section-label`
- Main text inside a cell/card: `.ui-data-title`
- Secondary text inside a cell/card: `.ui-data-meta`
- Generic helper copy not tied to a field or record: `.minor-text`

## Avoid

- Using `.minor-text` for everything
- Inline `fontSize`, `fontWeight`, `textTransform`, or muted colors for repeated labels
- Creating page-local label classes when the shared UI family already fits
