# Skill: add-Ticket

## Purpose
Use this skill when user intent is any of:
- add ticket
- add feature
- fix bug
- make plan
- update feature
- extend feature
- similar ticketing/handoff requests

This skill creates or updates a ticket and always ends with a handoff prompt for the next agent.

## Mandatory Rules
1. If user provides attachments/screenshots/images, extract all readable text and key facts from images.
2. Put extracted image facts directly into the ticket (not only in chat).
3. Be explicit and structured. Do not leave ambiguous problem statements.
4. After ticket is complete, always write a hand-off prompt.
5. Auto-create and use a ticket branch name format:
   - `<ticket-id>-<agent>-<summary>`
6. Every branch and every commit must be tied to the same ticket id.
7. Always return ticket name in final output.

## Ticket Filename Format
- `status-type-name.md`
- `status`: `plan` or `done`
- `type`: `new-feature`, `update-feature`, `extend-feature`, `fix-bug`
- `name`: short kebab-case summary

Examples:
- `plan-fix-bug-btcusd-ctrader-tp-mismatch.md`
- `done-update-feature-chart-snapshot-watermark.md`

## Ticket Header Fields (Required)
- `Ticket Type`: `New Feature | Update Feature | Extend Feature | Fix bug`
- `Ticket Status`: `Plan | Done`
- `Owner`: `N/A | Deepseek | <agent-name>`
- `Updated`: UTC timestamp (`YYYY-MM-DD HH:mm UTC`)

## Ticket Body Sections (Required Order)
1. `Problem`
2. `Investigation`
3. `Solution`
4. `Expected Output / Verification`

## Image Handling Checklist (Required when attachments exist)
- Capture exact strings/IDs/numbers shown in image.
- Capture context (page/panel/modal/source tool).
- Capture discrepancies (if user says value A but image shows value B).
- Capture evidence anchors (order id, position id, symbol, time, price, status).
- If text is partially visible, mark as partial (do not guess hidden text).

## Output Template
```markdown
# <short title>

## Meta
- Ticket Type: `<New Feature|Update Feature|Extend Feature|Fix bug>`
- Ticket Status: `<Plan|Done>`
- Owner: `<N/A|Deepseek|...>`
- Updated: `<YYYY-MM-DD HH:mm UTC>`

## Problem
<clear problem statement>

## Investigation
- Evidence:
- Findings:
- Open questions:

## Solution
<planned or completed fix details>

## Expected Output / Verification
- [ ] <check 1>
- [ ] <check 2>
```

## Handoff Prompt Template (Always append after ticket work)
```text
Read:
- <ticket-path>
- AI.md
- .agents/BOOTSTRAP.md
- relevant rules/docs

Task:
<exact implementation/investigation objective>

Constraints:
- preserve backward compatibility where required
- run required checks
- update mailbox/worklog
- work on branch: <ticket-id>-<agent>-<summary>
- commit format: <ticket-id>-<agent>-<summary>
- merge target branch: <target-branch>

Return:
- ticket name
- root cause / change summary
- files changed
- checks run
- deploy status
```

## Output Requirements (Mandatory)
- Always return:
  - `Ticket Name`
  - `Ticket Path`
  - `Branch Name` (auto-created from ticket id + agent + summary)
  - `Short Agent Handoff Prompt` (copy-paste ready)
