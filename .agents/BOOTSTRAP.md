# Unified AI Bootstrap (Source of Truth)

All AI agents in this repo must load project context in this exact order before planning, coding, or architecture advice:

1. `AI.md` (Root)
2. `.agents/BOOTSTRAP.md` (This file)
3. `.agents/rules.md`
4. `.agents/rules/*` (In alphabetical order)
5. `.agents/STATE.md`
6. `.agents/.product/architecture/db-schema.md`
7. `.agents/.product/tickets/feature_tracker.md`
8. `.agents/sync/MAILBOX.md`
9. `.agents/worklog.md`

## 1. Organization Map

- **`.agents/.product/`**: The "Knowledge" domain (Hidden from AI logic by default).
    - `architecture/`: Tech stack, Schema, API Design.
    - `features/`: Capability "Source of Truth" (Done/Plan).
    - `tickets/`: Lifecycle of active work and history.
- **`.agents/.raw/`**: The "Memory" domain (Not for AI logic).
    - Append-only raw logs and data.
- **`.agents/wiki/`: Distilled project lessons.
- **`.agents/rules/`**: **READ ON BOOT.** Mandatory boundaries and constraints.
- **`.agents/skills/`**: **READ ON DEMAND.** Step-by-step playbooks for specific tasks.
- **`.agents/sync/`**: Inter-agent communication (Mailbox).

## 2. Execution Rules

- **Source of Truth**: Treat `.agents/` as the authority for process and state.
- **Context Refresh**: Do not assume old chat memory is valid; re-read context per new conversation.
- **RTK Policy**: All shell commands must follow the RTK command policy.
- **Feature-First**: Any change to behavior must be documented in a Feature Doc in `.product/features/`.

## 3. Conflict Resolution

If documentation files disagree, the priority is:
1. `AI.md` (Root)
2. `.agents/rules.md`
3. `.agents/rules/*`
4. `.agents/.product/architecture/*`
5. `.agents/.product/features/*`
