# Sample Feature Ticket

## Meta
- ID: `FEAT-YYYYMMDD-001`
- Owner: `Agent-Builder-1`
- Mode: `Feature-Pod`
- Status: `ACTIVE`

## Outcome
- Add safe display timezone selection and prevent invalid timezone crashes in UI date formatting.

## Scope
- `web-ui/src/pages/settings/SettingsPage.jsx`
- `web-ui/src/utils/format.js`
- `web-ui/src/components/SessionClockBar.jsx`

## Out Of Scope
- Backend behavior changes
- DB schema changes

## Acceptance Criteria
1. Invalid timezone input cannot crash UI.
2. User can only pick supported timezone options.
3. Relative time labels update without page reload.

## Checks
- `npm --prefix web-ui run build`

## Dependency Gates
- Gate 1: formatter util updated
- Gate 2: settings selector updated
- Gate 3: session clock handles local timezone

## Handoff Requirement
- Post final handoff in `.agents/sync/MAILBOX.md` using `agent-handoff.md`.
