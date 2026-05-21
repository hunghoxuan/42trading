# AI snapshots in Files tab and parsed_json missing execution_plan

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Plan`
- Owner: `N/A`
- Updated: `2026-05-21 13:33 UTC`

## Problem
Two related AI TradePlan regressions remain:

1. **Snapshots used by AI are shown in the AI response area but should be shown in the `Files` tab**
   - Screen 1 shows snapshots used by AI near the response/card context.
   - Screen 2 `Files` tab is the expected home for snapshot files.
   - Move or duplicate the "snapshots used by AI" display into `Files` tab so all related files are centralized there.

2. **UI still cannot parse/show correct TradePlan data**
   - Raw AI response visibly contains populated plan data, including `execution_plan`.
   - UI still shows fallback/default values like `BUY`, `0`, empty TP fields, and numeric validation errors.
   - User suspects the AI response may be cut off by max tokens or max chars.

## Investigation
- Evidence:
  - Screenshot 1: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_5W3w1Z/Screenshot 2026-05-21 at 15.25.37.png`
  - Screenshot 2: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_NkC88L/Screenshot 2026-05-21 at 15.26.18.png`
  - Screenshot 2 shows TradePlan fields still rendering default/invalid values:
    - direction `Buy`
    - entry `0`
    - TP1 `0`
    - TP2/TP3 empty
    - error: `Entry/TP/SL must be numeric values.`
  - User-provided `raw_response` text includes:
    - root `direction: "BUY"`
    - `risk_management`
    - `execution_plan.entry.price = 77200`
    - `execution_plan.stop_loss.price = 76650`
    - `execution_plan.tp1.price = 78650`
    - `execution_plan.tp2.price = 79500`
    - `execution_plan.tp3.price = 80500`
- Findings:
  - The pasted raw response appears to include `execution_plan`; it is not obviously cut off in the visible text.
  - If stored/displayed `parsed_json` lacks `execution_plan`, likely failure boundary is one of:
    - JSON parse/repair extracts only a partial object.
    - max-char/max-token truncation occurs before parsing in server/client path, even if UI later shows a longer raw string.
    - parser normalizes/overwrites canonical payload with fallback/default TradePlan object.
    - client reads `parsed_json` from a wrapper or stale field that does not match `raw_response`.
  - `config/guide_system.md` was updated by user to place `risk_management` before `execution_plan` and explicitly require `execution_plan` after risk-management fields.
- Open questions:
  - Need inspect actual persisted API response row/log for one failing session to compare `raw_response`, `parsed_json`, and UI props.

## Solution
Implement in two parts:

1. **Move snapshots used by AI into Files tab**
   - Pass `snapshotsUsed` / `used_files` into `TradeFilesTab`.
   - Render a dedicated `Snapshots used by AI` section in the Files tab.
   - Use VPS-backed file links/paths when available.
   - Keep fallback state: if AI does not return exact used files, show submitted snapshot files as `used_by_ai: unknown`.

2. **Fix parsed_json / TradePlan extraction**
   - Add diagnostics for failing sessions:
     - raw response length
     - parse input length
     - whether text ends with complete `]` or `}`
     - parsed payload keys
     - whether `execution_plan` exists in raw text but not parsed object
   - Confirm max-token/max-char limits in both server route and client parser.
   - Ensure canonical parse source preserves root-level `execution_plan`.
   - Do not replace populated canonical payload with fallback BUY/0 template.
   - Add regression fixture from the user-provided sample.

## Expected Output / Verification
- [ ] `Files` tab shows snapshots used by AI.
- [ ] Snapshot entries in `Files` tab use actual VPS-backed file links/paths when available.
- [ ] UI parses the provided sample into a populated plan:
  - direction `BUY`
  - entry `77200`
  - SL `76650`
  - TP1 `78650`
  - TP2 `79500`
  - TP3 `80500`
- [ ] `parsed_json` retains `execution_plan` when raw response contains it.
- [ ] No fallback BUY/0 object is shown when canonical AI payload is valid.
- [ ] Add regression fixture/test for raw response with root `execution_plan`.
- [ ] `rtk npm --prefix web-ui run build`
- [ ] Browser verification with screenshots for `Files` tab and populated TradePlan editor.

## Handoff Prompt
```text
Tag: TICKET
Read:
- .agents/.product/tickets/1-backlog/2026-05-21-ai-snapshots-files-tab-and-parsed-json-missing-execution-plan.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/ui.md
- .agents/rules/testing.md
- .agents/rules/safety.md

Task:
Move snapshots used by AI into the Files tab, then fix parsed_json/TradePlan extraction so root-level execution_plan from AI raw_response is preserved and rendered. Use the sample from the ticket as a regression fixture.

Constraints:
- Preserve exact raw AI JSON in raw_json.
- Do not overwrite valid canonical payload with fallback BUY/0 template.
- Investigate max token/max char truncation, but verify against raw_response vs parsed_json before changing limits.

Return:
- ticket name
- root cause
- parser/limit findings
- files changed
- checks run
- deploy status
```
