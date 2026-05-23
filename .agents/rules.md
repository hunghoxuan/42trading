# Rules

## Boot Rules

Read on every new chat:

1. `rules/communication.md`
2. `rules/planning.md`
3. `rules/safety.md`
4. `rules/cli.md`
5. `rules/token.md`
6. `rules/scratch.md`

## Read Only When Task Needs It

- Handoff: `rules/handoff.md`
- DB: `rules/db.md`
- UI: `rules/ui.md`
- Deploy: `rules/deploy.md`
- Testing: `rules/testing.md`
- Scripts: `rules/scripting.md`
- Scratch: (moved to boot rules)
- Memory: `rules/memory-governance.md`
- Docs governance: `rules/documentation_integrity.md`
- Automation mining: `rules/automation_integrity.md`

## Global Law

- Keep context small.
- Read only what task needs.
- Do not break user behavior by accident.
- Test real code changes.
- Bump matched server/EA versions for backend, EA, UI, or script changes.
- After any change, auto update/refresh local `web-ui` and `webhook` without asking. Only ask before prod deploy.
- After any change, MUST auto test locally until fully fixed.
