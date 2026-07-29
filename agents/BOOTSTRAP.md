# Bootstrap

Read this first on every new chat.

## Start Here

1. Read `README.md`
2. Use `rtk` for shell commands
3. Load only the rule docs needed for the task

## Keep Only What Matters

- DB work: `agents/rules/db.md`
- UI work: `agents/rules/ui-rules.md`
- User-facing reports: `agents/rules/communication.md`
- Deploy or release work: `agents/rules/deploy.md`
- Local service start/restart: `scripts/start/README.md`
  Durable local services should use the `launchctl`-based flows in `start_dev.sh`, `start_api.sh launchctl`, or `start_admin.sh launchctl`.

## Core Law

- Keep context small.
- Read only task-needed docs.
- Test real code changes.
- Do not create new files in `scripts/` or `tests/` without explicit user approval.
- Put scratch or one-off files in `.local/`.
- Before reverting or restoring any code from git history, first create a backup copy or commit the current state to a git branch.
- Auto-commit work at end of day or immediately after each completed feature so recovery points always exist.
