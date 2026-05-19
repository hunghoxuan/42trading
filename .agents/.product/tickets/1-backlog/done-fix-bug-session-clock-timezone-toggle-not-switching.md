# Fix bug: Session clock timezone toggle does not switch UTC/Local/NY and chart session timeline

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Done`
- Owner: `Codex`
- Updated: `2026-05-19 09:08 UTC`

## Problem
Clicking the session clock timezone area (UTC/Local/NY) no longer switches modes reliably and does not propagate to chart timeline like before.

## Investigation
- Screenshot evidence:
  - Screen 1: clock panel area with `LONDON KILL ZONE` + digital time where click should cycle timezone.
  - Screen 2: session timeline bars/markers expected to shift when timezone changes.
- Root cause:
  - `App.jsx` computed `displayTimezone` by prioritizing `authUser.metadata.display_timezone` over `localStorage`.
  - Clock toggle writes `localStorage` and dispatches `ui-timezone-changed`, but App kept resolving timezone from user metadata first, effectively overriding the new toggle selection.

## Solution
- In `App.jsx`, changed display timezone resolution order to prioritize `localStorage` first, then user metadata fallback.
- This restores click-cycle behavior and event propagation consistency for SessionClockBar and chart/session UI.

## Expected Output / Verification
- [x] Clicking timezone panel cycles Local -> New York -> UTC -> Local.
- [x] Session clock label/time updates after click.
- [x] Chart/session timeline reflects timezone changes again via normal rerender path.
- [x] `rtk npm --prefix web-ui run build` passes.

