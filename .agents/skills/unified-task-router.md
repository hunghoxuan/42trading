# Skill: Unified Task Router (Master)

## Goal
Default auto-flow when user does not explicitly name a skill.
Interpret conversation intent, route to the right workflow, keep ticket state updated, and finish with deploy + handoff when code changed.

## Identity
- Agent identity in this workspace: `Codex`.
- At session start or when asked "who are you", answer clearly with current identity.

## Intent Auto-Detect (Per Response)
After each response/task, detect intent from user language and context:

1. Fixing/broken/error/regression:
- Route: `fix-bug-mode` + `add-Ticket`
- Ticket Type: `Fix bug`
- Ticket Status: `Plan` until fix lands, then `Done`

2. New capability/feature/task request:
- Route: `fullstack-feature-mode` (or `planning-mode` first if large) + `add-Ticket`
- Ticket Type: `New Feature`
- Ticket Status: `Plan` until shipped, then `Done`

3. Enhancement/change to existing capability:
- Route: `fullstack-feature-mode` + `add-Ticket`
- Ticket Type: `Update Feature` or `Extend Feature`
- Ticket Status: `Plan` until shipped, then `Done`

4. Project knowledge/discovery/audit/question:
- Route: investigation mode + `add-Ticket` (knowledge/update ticket)
- Ticket Type: default `Update Feature` (or `Extend Feature` if scope expansion is proposed)
- Ticket Status: `Plan` unless concrete action completed

## Ticket Automation Rules
1. Always create or update a ticket when work is non-trivial.
2. If screenshots/attachments exist, extract text/evidence into the ticket.
3. Use filename format: `status-type-name.md`.
4. Required ticket fields:
- Ticket Type
- Ticket Status
- Owner
- Updated time (UTC)
- Problem
- Investigation
- Solution
- Expected Output / Verification
5. After finishing ticket/task, append a handoff prompt.
6. If agent is `Codex`, or conversation includes images/screenshots:
- Write ticket + handoff first with detailed findings/instructions/solution/verification.
- Execute code changes only when user explicitly asks to execute/fix/implement now.
7. Ticket content quality:
- Include exact evidence anchors (ids, symbols, prices, timestamps, logs, URLs, screenshots).
- Include clear step-by-step instruction for the next agent.

## Deploy + Handoff Automation
When code changed and checks passed:
1. Run required checks by touched surface.
2. Bump versions if backend/EA/UI/scripts changed.
3. Before deploy, sync latest `origin/main` and confirm changes are merged with latest work from other agents.
4. Follow deploy lock/SOP.
5. Deploy without waiting for extra confirmation.
6. Verify live health and key path.
7. Confirm deploy success with explicit deployed version value.
8. Write mailbox handoff note + worklog entry.

When docs-only/no code change:
1. Do not deploy.
2. Still write ticket status and handoff prompt.

## Safety Guardrails
- Never deploy if required checks fail.
- Never skip lock/SOP for multi-agent deploy.
- Keep raw AI trade plan JSON intact in `raw_json`.
- Keep compatibility fields (`tp` alias etc.) when relevant.

## Response Report Format (Mandatory)
In final reports, always include these tables:

### Evidence and Findings
| Evidence | Finding |
|---|---|
| `<evidence item>` | `<what it proves>` |

### Files Changed
| File | Changed |
|---|---|
| `<path>` | `<summary>` |

### Task Status
| Task | Status |
|---|---|
| `<task item>` | `DONE | IN_PROGRESS | BLOCKED | NOT_RUN` |
