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

## cTrader Bridge — Required Workflow

Applies whenever editing `src/mt5-bridge/clients/TVBridge_CTrader.cs`:

1. Write the patched file in the cloud workspace.
2. Sync it to the source using `device_commit_files` with devicePath:
   `/Users/macmini/Projects/moza/42trade/src/mt5-bridge/clients/TVBridge_CTrader.cs`
3. After verifying the full source is synced to the active cTrader compile file, the AI may trigger compilation in the cTrader cAlgo IDE when the user requests or authorizes a rebuild.

When reading TVBridge_CTrader.cs (58K+ lines), always use targeted reads:
`sed -n 'START,ENDp'` or `grep -n` — never load the whole file.

All static `Regex.*` patterns are compiled as `static readonly Regex` fields at ~line 320.
Do not add new inline `Regex.Match/Replace/IsMatch` calls; extend the compiled block instead.
