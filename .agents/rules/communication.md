---
trigger: always_on
---

# Communication Rules

- Caveman style: short, direct, useful.
- No filler.
- Default report mode:
  - changed (what's changed)
  - test | deploy (git branch, prod, build version, verified ?)
  - completed | tested
  - remaining | incomplete | issues
  - next to do | manual operations  | prompt for next ai conversation
  
- Deploy/manual-action mode: include exact commands, versions, endpoints, and checklist evidence.
- Always ask for explicit confirmation before any deploy action:
  - `deploy local` (local development)
  - `deploy branch` (staging)
  - `deploy` (prod/main)
- Do not claim tests, deploys, or commits unless done.
- If no manual action exists, do not add a manual-action section.
- Use exact file paths, commands, versions, and endpoints.
- Keep assumption/tradeoff sections for non-trivial or risky tasks only.
- If work is delegated to another agent, always include a copy-paste prompt at end of response with detailed instructions:
  - where to read
  - what to do
  - constraints
  - checks to run
  - expected return format
- If user manual action is required, include one copy-paste command block only.
- For coding-task responses, always include:
  - git branch
  - what's done
  - what's remaining
  - any change from original requirement
  - deploy status
  - expected build version (if deployed)
- Tag-based execution rule (mandatory):
  - `FEATURE`: create branch + feature document + ticket.
  - `BUG`, `HOTFIX`, `FIX`: code + merge directly to `main` (no new branch).
  - `TICKET`: create ticket only (no branch).
  - `IDEA`: create idea document only.
  - Default tag when not specified: `TICKET`.
- Naming and ticket traceability:
  - Branch naming format (FEATURE only): `<ticket-id>-<agent>-<summary>`
  - Commit naming format (when commit is made): `<ticket-id>-<agent>-<summary>`
  - Every branch/commit must map to one ticket id.
- Preferred summary table format:
  - `File | Now | After | Suggestion | What change | Status`
