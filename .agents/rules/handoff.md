# Handoff Rules

- Worklog is mandatory.
- At START of significant work, post/update current task in `.agents/sync/MAILBOX.md`.
- At FINISH, add:
  - changed files
  - technical decisions
  - tests/checks
  - deploy status
  - build versions if changed
  - all AI-made changes not explicitly in user spec/requirements
  - tradeoffs AI considered
  - anything user should be aware of
- Use `.agents/sync/MAILBOX.md` only for agent-to-agent relay.
- Keep sprint ownership markers. Do not steal `[DOING: other-agent]` work.
- Put durable lessons in `.agents/wiki/`.
- Any delegated work must have handoff documentation before asking another agent to execute.
- Handoff doc must include clear work description:
  - exact ticket/file to read
  - implementation scope
  - non-goals
  - checks/tests
  - output/report format
  - assumptions/decisions not in spec + their tradeoff/risk
- Handoff doc mandatory header fields:
  - git branch
  - AI agent name
  - what's done
  - what's remaining
  - continuation instructions (step-by-step)
  - deploy status + expected build version (if deployed)
- Mirror the same detailed delegation prompt at end of user-facing chat so user can copy-paste to other agent.
- **On ticket finish**: update MAILBOX handoff section (status → DONE, add next agent relay), and include a copy-paste prompt in chat instructing the next agent what to do (read ticket, run checks, deploy, etc).

## Multi-Agent Sync Contract (Mandatory)

- Every agent must claim ownership in `.agents/sync/MAILBOX.md` before coding:
  - `STATUS=DOING`
  - owned files/modules
  - expected finish time
- On finish, agent must post:
  - `STATUS=DONE`
  - branch name
  - commit SHA
  - merge/PR status
  - deploy status (`NOT_DEPLOYED` or deployed version)
- Never deploy from a feature branch that is not merged to `main`.
- Next deployer must sync latest `main` again before deploy, even if synced 5 minutes ago.
- If overlapping files exist between agents, second finisher must rebase/merge latest `main`, resolve conflicts, re-test, then merge.
