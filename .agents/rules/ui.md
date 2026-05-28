# UI Rules

- **MANDATORY**: Read `.agents/rules/design-system.md` before writing any JSX component. Use CSS classes from the catalog instead of inline `style={{}}`.
- Follow existing design system first.
- Use dense, work-focused layouts for trading/admin tools.
- Page wrapper: `stack-layout fadeIn`.
- Toolbar:
  - left: pagination/count
  - right: filters, bulk actions, primary action
- Buttons:
  - primary: create/apply/save
  - secondary: navigation/utility
  - danger: destructive
- Forms:
  - label above input
  - validation directly below related input/group
  - form-level error above action buttons
  - disabled + spinner while submitting
  - save/add/submit enabled only when dirty and valid
- Feedback colors:
  - error red
  - warning yellow
  - success green
- Never render credentials.
- Time display uses `showDateTime`.

## Visual Verification Policy (Token/Cost Optimized)

- Default: no screenshot recapture for small UI edits.
- Require screenshot/browser recapture only when:
  - user explicitly asks for it, or
  - new page/layout is introduced, or
  - large visual refactor/high regression risk.
- For standard edits, use:
  - `rtk npm --prefix web-ui run build`
  - concise manual verification notes.
